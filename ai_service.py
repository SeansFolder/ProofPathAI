"""Pluggable AI layer for ProofPath.

Segmentation (SAM 3.1 compatible) and report reasoning (Muse Spark
compatible) run behind user-configured HTTP endpoints, typically deployed
on Modal with GPU resources. Nothing is called unless the matching
endpoint environment variable is set. Image generation (Muse Image
compatible) is optional and off by default.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re

import httpx

logger = logging.getLogger("proofpath.ai")

SEGMENT_PROVIDER = "modal-sam"
REASONING_PROVIDER = "muse-spark"
IMAGE_PROVIDER = "muse-image"
FALLBACK_PROVIDER = "local-fallback"

CATEGORIES = [
    "Road damage",
    "Waste and litter",
    "Street lighting",
    "Sidewalk and access",
    "Drainage and flooding",
    "Public facility",
    "Other",
]


class AIServiceNotConfigured(Exception):
    """Raised when the endpoint for a capability is not set."""


class AIServiceError(Exception):
    """Raised when a configured endpoint fails or returns bad data."""


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _timeout_seconds() -> float:
    try:
        return max(5.0, min(120.0, float(_env("PROOFPATH_AI_TIMEOUT_SECONDS", "30"))))
    except ValueError:
        return 30.0


def _max_image_bytes() -> int:
    try:
        return max(1024 * 1024, int(_env("PROOFPATH_AI_MAX_IMAGE_BYTES", str(8 * 1024 * 1024))))
    except ValueError:
        return 8 * 1024 * 1024


def get_ai_status() -> dict:
    """Capability flags for health checks and the frontend. Never includes secrets."""
    sam = bool(_env("PROOFPATH_MODAL_SAM_ENDPOINT"))
    spark = bool(_env("PROOFPATH_SPARK_ENDPOINT"))
    image = bool(_env("PROOFPATH_IMAGE_ENDPOINT"))
    return {
        "segmentation": {"configured": sam, "provider": SEGMENT_PROVIDER if sam else None},
        "reasoning": {"configured": spark, "provider": REASONING_PROVIDER if spark else None},
        "image_generation": {"configured": image, "provider": IMAGE_PROVIDER if image else None},
        "background_jobs": True,
        "batch": True,
    }


def _auth_headers(token: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _normalize_mask(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    bbox = raw.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    try:
        x, y, w, h = (max(0.0, min(1.0, float(v))) for v in bbox)
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    try:
        score = max(0.0, min(1.0, float(raw.get("score", 0.0))))
    except (TypeError, ValueError):
        score = 0.0
    polygon = None
    if isinstance(raw.get("polygon"), list):
        points = []
        for point in raw["polygon"][:256]:
            if isinstance(point, list) and len(point) == 2:
                try:
                    points.append([max(0.0, min(1.0, float(point[0]))), max(0.0, min(1.0, float(point[1])))])
                except (TypeError, ValueError):
                    return None
        if len(points) >= 3:
            polygon = points
    mask = {"label": str(raw.get("label", "object"))[:60], "score": round(score, 4), "bbox": [x, y, w, h]}
    if polygon is not None:
        mask["polygon"] = polygon
    return mask


async def segment_image(image_bytes: bytes, mime_type: str, prompt: str | None = None) -> dict:
    """Send an image to the Modal segmentation endpoint and normalize masks.

    Expected endpoint contract: POST JSON
    {"image_base64": ..., "mime_type": ..., "prompt": ...} and returns
    {"masks": [{"label", "score", "bbox": [x,y,w,h] normalized, "polygon"?}],
     "width"?, "height"?}. Bounding boxes are normalized 0-1 relative to the
    image the endpoint processed.
    """
    endpoint = _env("PROOFPATH_MODAL_SAM_ENDPOINT")
    if not endpoint:
        raise AIServiceNotConfigured("segmentation")
    if len(image_bytes) > _max_image_bytes():
        raise ValueError("Image is larger than the AI size limit.")
    payload: dict[str, object] = {
        "image_base64": base64.b64encode(image_bytes).decode(),
        "mime_type": mime_type,
    }
    if prompt:
        payload["prompt"] = prompt[:300]
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            response = await client.post(endpoint, json=payload, headers=_auth_headers(_env("PROOFPATH_MODAL_TOKEN")))
    except httpx.HTTPError as exc:
        logger.warning("segmentation request failed: %s", exc)
        raise AIServiceError("Segmentation endpoint did not respond.") from exc
    if response.status_code >= 400:
        logger.warning("segmentation endpoint returned %s", response.status_code)
        raise AIServiceError(f"Segmentation endpoint returned {response.status_code}.")
    try:
        data = response.json()
    except ValueError as exc:
        raise AIServiceError("Segmentation endpoint returned invalid data.") from exc
    raw_masks = data.get("masks", []) if isinstance(data, dict) else []
    masks = []
    if isinstance(raw_masks, list):
        for raw in raw_masks[:50]:
            mask = _normalize_mask(raw)
            if mask is not None:
                masks.append(mask)
    result: dict[str, object] = {"provider": SEGMENT_PROVIDER, "masks": masks}
    if isinstance(data, dict):
        for key in ("width", "height"):
            if isinstance(data.get(key), int) and data[key] > 0:
                result[key] = data[key]
    return result


def _assist_messages(observation: str, title: str | None, category: str | None, location: str | None) -> list[dict]:
    details = [f"Observation: {observation}"]
    if title:
        details.append(f"Title: {title}")
    if category:
        details.append(f"Category: {category}")
    if location:
        details.append(f"Location: {location}")
    return [
        {
            "role": "system",
            "content": (
                "You organize community issue reports. Use ONLY the user's verified "
                "observation and details; never invent causes, severity, timing, or "
                "official findings. Reply with JSON only, no markdown fences: "
                '{"structured_description": string, "suggested_category": one of '
                + json.dumps(CATEGORIES)
                + ' or null, "missing_info": [short strings], '
                '"followup_questions": [short questions]}.'
            ),
        },
        {"role": "user", "content": "\n".join(details)},
    ]


def _parse_assist_content(content: str) -> dict:
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("assist payload is not an object")
    description = str(data.get("structured_description", "")).strip()
    if not description:
        raise ValueError("assist payload has no description")
    suggested = data.get("suggested_category")
    if suggested not in CATEGORIES:
        suggested = None

    def _string_list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip()[:200] for item in value if str(item).strip()][:8]

    return {
        "structured_description": description[:2000],
        "suggested_category": suggested,
        "missing_info": _string_list(data.get("missing_info")),
        "followup_questions": _string_list(data.get("followup_questions")),
    }


def local_assist_fallback(observation: str, title: str | None, category: str | None, location: str | None) -> dict:
    """Deterministic no-AI helper used when reasoning is not configured."""
    text = observation.strip()
    lower = text.lower()
    missing: list[str] = []
    followups: list[str] = []
    has_when = bool(re.search(r"\b(today|yesterday|morning|afternoon|evening|night|week|month|o'clock|[ap]\.?m\.?|\d{1,2}:\d{2})\b", lower))
    if not has_when:
        missing.append("when you noticed it")
        followups.append("When did you first notice this?")
    if not location:
        missing.append("precise location")
        followups.append("What street or nearby landmark identifies the spot?")
    if len(text) < 80:
        missing.append("visible detail (size, extent, what is affected)")
        followups.append("What exactly can you see, and how large is the affected area?")
    if not category:
        missing.append("report category")
    return {
        "provider": FALLBACK_PROVIDER,
        "structured_description": text[:2000],
        "suggested_category": None,
        "missing_info": missing,
        "followup_questions": followups,
        "note": "AI reasoning is not connected. This checklist is a local helper, not model output.",
    }


async def assist_report(observation: str, title: str | None = None, category: str | None = None, location: str | None = None) -> dict:
    """Organize an observation via the reasoning endpoint, or local fallback."""
    endpoint = _env("PROOFPATH_SPARK_ENDPOINT")
    if not endpoint:
        return local_assist_fallback(observation, title, category, location)
    model = _env("PROOFPATH_SPARK_MODEL", REASONING_PROVIDER) or REASONING_PROVIDER
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            response = await client.post(
                endpoint,
                json={"model": model, "messages": _assist_messages(observation, title, category, location), "temperature": 0.2, "max_tokens": 600},
                headers=_auth_headers(_env("PROOFPATH_SPARK_API_KEY")),
            )
    except httpx.HTTPError as exc:
        logger.warning("reasoning request failed: %s", exc)
        raise AIServiceError("Reasoning endpoint did not respond.") from exc
    if response.status_code >= 400:
        logger.warning("reasoning endpoint returned %s", response.status_code)
        raise AIServiceError(f"Reasoning endpoint returned {response.status_code}.")
    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        parsed = _parse_assist_content(str(content))
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIServiceError("Reasoning endpoint returned invalid data.") from exc
    parsed["provider"] = REASONING_PROVIDER
    parsed["model"] = model
    parsed["note"] = "Suggestion only. Your words remain your own; verify before saving."
    return parsed


async def generate_awareness_graphic(prompt: str, style: str | None = None) -> dict:
    """Generate a supporting graphic via the optional image endpoint."""
    endpoint = _env("PROOFPATH_IMAGE_ENDPOINT")
    if not endpoint:
        raise AIServiceNotConfigured("image_generation")
    full_prompt = prompt.strip()
    if style:
        full_prompt += f" Style: {style.strip()}"[:120]
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            response = await client.post(
                endpoint,
                json={"prompt": full_prompt[:1000], "size": "1024x1024", "response_format": "b64_json"},
                headers=_auth_headers(_env("PROOFPATH_IMAGE_API_KEY")),
            )
    except httpx.HTTPError as exc:
        logger.warning("image request failed: %s", exc)
        raise AIServiceError("Image endpoint did not respond.") from exc
    if response.status_code >= 400:
        logger.warning("image endpoint returned %s", response.status_code)
        raise AIServiceError(f"Image endpoint returned {response.status_code}.")
    try:
        data = response.json()
        first = data["data"][0]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIServiceError("Image endpoint returned invalid data.") from exc
    result: dict[str, object] = {"provider": IMAGE_PROVIDER}
    if isinstance(first, dict):
        if first.get("b64_json"):
            result["image_base64"] = first["b64_json"]
        elif first.get("url"):
            result["image_url"] = first["url"]
    if "image_base64" not in result and "image_url" not in result:
        raise AIServiceError("Image endpoint returned no image.")
    return result
