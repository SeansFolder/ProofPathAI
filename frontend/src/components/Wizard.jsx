import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES, api, formatLongDate } from '../api.js';
import { markDraftScreen, savePendingDraft } from '../draftStore.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const STEPS = ['Evidence', 'Observations', 'Details', 'Review'];
const OVERLAY_FILLS = ['rgba(36, 77, 60, 0.32)', 'rgba(163, 124, 52, 0.34)'];

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function prettifyLabel(label) {
  const cleaned = String(label || '').replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Unlabeled region';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function observationFromMask(mask, index) {
  const id = padNumber(index + 1);
  const label = prettifyLabel(mask.label);
  const confidence = Math.round((mask.score || 0) * 100);
  return {
    id,
    title: label,
    body: `AI outline ${id} · ${label} · ${confidence}% confidence. Include only if you can verify it in the photo.`,
    selected: true,
  };
}

function selectedObservations(observations) {
  return observations.filter((item) => item.selected);
}

function composeDescription(observations, location, assistText) {
  const parts = [];
  if (assistText) {
    parts.push(assistText);
  } else if (observations.length > 0) {
    parts.push(`Observed: ${observations.map((item) => item.title).join('; ')}.`);
  }
  if (location) parts.push(`Location supplied by the resident: ${location}.`);
  return parts.join(' ');
}

export default function Wizard({ aiStatus, signedIn, ownerId = null, initialCategory = '', initialDraft = null, onSaved, onCancel, onRequireAccount, onSignIn }) {
  const draftPhase = ['evidence', 'observations', 'details', 'review'].includes(initialDraft?.phase) && initialDraft?.file
    ? initialDraft.phase
    : 'evidence';
  const [phase, setPhase] = useState(draftPhase);
  const [file, setFile] = useState(initialDraft?.file || null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [displayUrl, setDisplayUrl] = useState(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [stripMetadata, setStripMetadata] = useState(initialDraft?.stripMetadata ?? true);
  const [blurDetails, setBlurDetails] = useState(initialDraft?.blurDetails ?? true);
  const [blurHint, setBlurHint] = useState('Drag on the photo to blur faces, plates, or other identifying details.');
  const [dragging, setDragging] = useState(false);
  const [analysisNote, setAnalysisNote] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [assistText, setAssistText] = useState('');
  const [assistProvider, setAssistProvider] = useState('');
  const [observations, setObservations] = useState(initialDraft?.observations || []);
  const [masks, setMasks] = useState([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [customTitle, setCustomTitle] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [location, setLocation] = useState(initialDraft?.location || '');
  const [category, setCategory] = useState(initialDraft?.category || initialCategory);
  const [observedDate, setObservedDate] = useState(initialDraft?.observedDate || '');
  const [residentContext, setResidentContext] = useState(initialDraft?.residentContext || '');
  const [title, setTitle] = useState(initialDraft?.title || '');
  const [titleDirty, setTitleDirty] = useState(Boolean(initialDraft?.title));
  const [description, setDescription] = useState(initialDraft?.description || '');
  const [descriptionDirty, setDescriptionDirty] = useState(Boolean(initialDraft?.description));
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [formError, setFormError] = useState(false);
  // True once a protected call answers 401: the draft stays autosaved while
  // the visitor signs back in through onSignIn (no hard redirect, no loss).
  const [sessionExpired, setSessionExpired] = useState(false);

  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const topRef = useRef(null);
  const loadedPhotoRef = useRef(null);
  const photoReadyRef = useRef(Promise.resolve());
  const redactionPathsRef = useRef(initialDraft?.redactionPaths || []);
  const activeRedactionRef = useRef(null);
  const savedFileRef = useRef(null);

  // Snapshot the in-progress draft (photo, reviewed details, location, and
  // privacy choices) so the save-gate handoff can restore it after auth.
  function collectDraft(atPhase) {
    return {
      file,
      title,
      category,
      description,
      location,
      observedDate,
      residentContext,
      observations,
      stripMetadata,
      blurDetails,
      redactionPaths: redactionPathsRef.current,
      phase: atPhase,
      ownerId,
    };
  }
  const analyzeAbortRef = useRef(null);
  const displayUrlsRef = useRef([]);
  const phaseRef = useRef(phase);

  const isVideo = Boolean(file && file.type.startsWith('video/'));
  const segmentationOn = Boolean(aiStatus?.segmentation?.configured);
  const reasoningOn = Boolean(aiStatus?.reasoning?.configured);
  const checked = useMemo(() => selectedObservations(observations), [observations]);
  const missingDetails = useMemo(() => {
    const missing = [];
    if (!location.trim()) missing.push('location');
    if (!category) missing.push('category');
    if (title.trim().length < 3) missing.push('title');
    if (description.trim().length < 10) missing.push('description');
    return missing;
  }, [location, category, title, description]);
  const detailsComplete = missingDetails.length === 0;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep the in-progress draft restorable across refresh, registration, the
  // full-page verify link, and sign-in. Metadata goes to localStorage on
  // every meaningful change; the file stays in IndexedDB.
  useEffect(() => {
    markDraftScreen('wizard');
  }, []);

  useEffect(() => {
    const empty =
      !file && !title.trim() && !category && !description.trim() && !location.trim()
      && !residentContext.trim() && !observedDate && observations.length === 0;
    if (empty) return;
    // The file is rewritten to IndexedDB only when it changes; metadata is
    // cheap to rewrite on every keystroke.
    const nextFile = file !== savedFileRef.current ? file : null;
    savedFileRef.current = file;
    savePendingDraft({
      title,
      category,
      description,
      location,
      observedDate,
      residentContext,
      observations,
      stripMetadata,
      blurDetails,
      redactionPaths: redactionPathsRef.current,
      phase,
      file: nextFile,
      ownerId,
    });
  }, [file, title, category, description, location, observedDate, residentContext, observations, stripMetadata, blurDetails, phase, ownerId]);

  useEffect(() => () => {
    for (const url of displayUrlsRef.current) URL.revokeObjectURL(url);
    if (analyzeAbortRef.current) analyzeAbortRef.current.abort();
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setDisplayUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    if (file.type.startsWith('video/')) setDisplayUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function trackDisplayUrl(url) {
    if (url && url.startsWith('blob:')) displayUrlsRef.current.push(url);
    setDisplayUrl(url);
  }

  function drawPhotoPreview() {
    const canvas = canvasRef.current;
    const photo = loadedPhotoRef.current;
    if (!canvas || !photo) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    const paths = blurDetails ? redactionPathsRef.current : [];
    if (paths.length === 0) return;
    const blurred = document.createElement('canvas');
    blurred.width = canvas.width;
    blurred.height = canvas.height;
    const blurredContext = blurred.getContext('2d');
    blurredContext.filter = 'blur(14px)';
    blurredContext.drawImage(photo, 0, 0, blurred.width, blurred.height);
    blurredContext.filter = 'none';
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext('2d');
    maskContext.strokeStyle = '#fff';
    maskContext.lineWidth = Math.max(24, canvas.width * 0.045);
    maskContext.lineCap = 'round';
    maskContext.lineJoin = 'round';
    for (const path of paths) {
      if (path.length === 1) {
        maskContext.beginPath();
        maskContext.arc(path[0].x, path[0].y, maskContext.lineWidth / 2, 0, Math.PI * 2);
        maskContext.fillStyle = '#fff';
        maskContext.fill();
        continue;
      }
      maskContext.beginPath();
      maskContext.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) maskContext.lineTo(point.x, point.y);
      maskContext.stroke();
    }
    blurredContext.globalCompositeOperation = 'destination-in';
    blurredContext.drawImage(mask, 0, 0);
    context.drawImage(blurred, 0, 0);
  }

  useEffect(() => {
    if (!file || file.type.startsWith('video/') || !previewUrl) {
      loadedPhotoRef.current = null;
      photoReadyRef.current = Promise.resolve();
      return;
    }
    // Restored drafts keep their blur marks: only acceptFile/removePhoto
    // clear redactions, so a returning draft is never wiped on reload.
    activeRedactionRef.current = null;
    const photo = new Image();
    photoReadyRef.current = new Promise((resolve) => {
      photo.onload = () => {
        loadedPhotoRef.current = photo;
        const canvas = canvasRef.current;
        if (canvas) {
          const scale = Math.min(1, 2400 / Math.max(photo.naturalWidth, photo.naturalHeight));
          canvas.width = Math.round(photo.naturalWidth * scale);
          canvas.height = Math.round(photo.naturalHeight * scale);
          drawPhotoPreview();
        }
        resolve();
      };
      photo.onerror = () => {
        setEvidenceError('We could not read that file. Choose a clear JPG or PNG photo to try again.');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        resolve();
      };
    });
    photo.src = previewUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, previewUrl]);

  useEffect(() => {
    drawPhotoPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurDetails]);

  function needsPrivacyPrepare() {
    return Boolean(file) && !file.type.startsWith('video/') && (stripMetadata || (blurDetails && redactionPathsRef.current.length > 0));
  }

  function renderPrivacyCanvas() {
    const photo = loadedPhotoRef.current;
    if (!photo || !photo.naturalWidth || !photo.naturalHeight) return null;
    const scale = Math.min(1, 2400 / Math.max(photo.naturalWidth, photo.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    const paths = blurDetails ? redactionPathsRef.current : [];
    if (paths.length === 0) return canvas;
    const blurred = document.createElement('canvas');
    blurred.width = canvas.width;
    blurred.height = canvas.height;
    const blurredContext = blurred.getContext('2d');
    blurredContext.filter = 'blur(14px)';
    blurredContext.drawImage(photo, 0, 0, blurred.width, blurred.height);
    blurredContext.filter = 'none';
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext('2d');
    maskContext.strokeStyle = '#fff';
    maskContext.lineWidth = Math.max(24, canvas.width * 0.045);
    maskContext.lineCap = 'round';
    maskContext.lineJoin = 'round';
    for (const path of paths) {
      if (path.length === 1) {
        maskContext.beginPath();
        maskContext.arc(path[0].x, path[0].y, maskContext.lineWidth / 2, 0, Math.PI * 2);
        maskContext.fillStyle = '#fff';
        maskContext.fill();
        continue;
      }
      maskContext.beginPath();
      maskContext.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) maskContext.lineTo(point.x, point.y);
      maskContext.stroke();
    }
    blurredContext.globalCompositeOperation = 'destination-in';
    blurredContext.drawImage(mask, 0, 0);
    context.drawImage(blurred, 0, 0);
    return canvas;
  }

  function refreshDisplayPreview() {
    if (!file) {
      setDisplayUrl(null);
      return;
    }
    if (!needsPrivacyPrepare()) {
      setDisplayUrl(previewUrl);
      return;
    }
    photoReadyRef.current.then(() => {
      const canvas = renderPrivacyCanvas();
      if (!canvas) {
        setDisplayUrl(previewUrl);
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          setDisplayUrl(previewUrl);
          return;
        }
        trackDisplayUrl(URL.createObjectURL(blob));
      }, file.type, 0.92);
    });
  }

  const [pendingFile, setPendingFile] = useState(null);

  function applyFile(next) {
    redactionPathsRef.current = [];
    activeRedactionRef.current = null;
    setObservations([]);
    setMasks([]);
    setAnalysisNote('');
    setAnalysisError('');
    setAssistText('');
    setAssistProvider('');
    setFormMessage('');
    setFile(next);
  }

  function acceptFile(next) {
    setEvidenceError('');
    if (!next) return;
    if (!ACCEPTED_TYPES.has(next.type)) {
      setEvidenceError('We could not read that file. Choose a clear JPG or PNG photo to try again.');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setEvidenceError('Evidence must be smaller than 20 MB. Choose another file to continue.');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // Replacing evidence discards analysis and edits tied to the current
    // file, so confirm first when there is anything to lose.
    const losesWork = Boolean(file) && (
      observations.length > 0 || masks.length > 0 || assistText !== '' ||
      description.trim() !== '' || title.trim() !== '' || redactionPathsRef.current.length > 0
    );
    if (losesWork) {
      setPendingFile(next);
      return;
    }
    applyFile(next);
  }

  function removePhoto() {
    setFile(null);
    setObservations([]);
    setMasks([]);
    setAnalysisNote('');
    setAnalysisError('');
    setAssistText('');
    setAssistProvider('');
    setEvidenceError('');
    redactionPathsRef.current = [];
    activeRedactionRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPhase('evidence');
  }

  function imagePoint(event) {
    const canvas = canvasRef.current;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  }

  function clearRedactions() {
    redactionPathsRef.current = [];
    activeRedactionRef.current = null;
    drawPhotoPreview();
    setBlurHint('Blur marks cleared. Drag on the photo to mark details again.');
  }

  function goToPhase(next) {
    if (next === 'observations' || next === 'details' || next === 'review') refreshDisplayPreview();
    setPhase(next);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startAnalysis() {
    if (!file) return;
    if (!signedIn) {
      // Guests continue without AI: analysis needs a signed-in account, so
      // the guest reviews manually added observations only. Nothing is
      // fabricated here; the save gate at review handles sign-in.
      setMasks([]);
      setAnalysisNote('');
      goToPhase('observations');
      return;
    }
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    setAnalysisNote('');
    setAnalysisError('');
    setPhase('analyzing');
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (async () => {
      let found = [];
      let note = '';
      try {
        if (isVideo) {
          note = 'Video analysis is not available yet. Continue with your own words below.';
        } else if (!segmentationOn && !reasoningOn) {
          note = 'AI suggestions are not connected. ProofPath did not analyze this image. Your words remain your own.';
        } else {
          let masksResult = [];
          if (segmentationOn) {
            try {
              const result = await api.segment(file, controller.signal);
              masksResult = result.masks || [];
            } catch (error) {
              if (error?.name === 'AbortError' || controller.signal.aborted) throw error;
              if (error?.status === 401) throw error;
              note = `Object outlines are unavailable right now (${error.message || 'segmentation failed'}). `;
            }
          } else {
            note = 'Object outlines are not connected. ';
          }
          found = masksResult.map((mask, index) => observationFromMask(mask, index));
          setMasks(masksResult);
          if (reasoningOn && found.length > 0) {
            const seed = `The photo shows ${found.map((item) => item.title).join(', ')}.`;
            if (seed.length >= 10) {
              try {
                const assist = await api.assist(
                  {
                    observation: seed,
                    title: title.trim() || null,
                    category: category || null,
                    location: location.trim() || null,
                  },
                  controller.signal,
                );
                if (assist && assist.provider !== 'unavailable' && assist.structured_description) {
                  setAssistText(assist.structured_description);
                  setAssistProvider(assist.provider || 'AI suggestion');
                } else {
                  note += 'Report wording help is unavailable right now. ';
                  setAssistProvider('unavailable');
                }
              } catch (error) {
                if (error?.name === 'AbortError' || controller.signal.aborted) throw error;
                if (error?.status === 401) throw error;
                note += 'Report wording help is unavailable right now. ';
                setAssistProvider('unavailable');
              }
            }
          } else if (!reasoningOn) {
            note += 'Report wording help is not connected. ';
          }
          if (found.length === 0 && !note) note = 'No distinct objects found. Your description still matters most.';
        }
        if (phaseRef.current !== 'analyzing') return;
        setObservations(found);
        setShowOverlay(found.length > 0);
        setAnalysisNote(note);
        setPhase('ready');
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) {
          if (phaseRef.current === 'analyzing') setPhase('evidence');
          return;
        }
        if (phaseRef.current !== 'analyzing') return;
        if (error?.status === 401) {
          // Session expired mid-analysis: stop protected requests, keep the
          // autosaved draft, and explain sign-in is required. The draft is
          // preserved, so signing in resumes without duplicates.
          try {
            sessionStorage.setItem('proofpath.sessionExpired', '1');
          } catch {
            // Storage failure must never break the reporting flow.
          }
          setSessionExpired(true);
          setAnalysisError('');
          setAnalysisNote('');
          setPhase('evidence');
          return;
        }
        setAnalysisError(error.message || 'Analysis failed. Try again.');
        setPhase('evidence');
      } finally {
        if (analyzeAbortRef.current === controller) analyzeAbortRef.current = null;
      }
    })();
  }

  function cancelAnalysis() {
    if (analyzeAbortRef.current) analyzeAbortRef.current.abort();
    setPhase('evidence');
  }

  function toggleObservation(id) {
    setObservations((current) => current.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)));
  }

  function addCustomObservation() {
    const trimmedTitle = customTitle.trim();
    const trimmedBody = customBody.trim();
    if (trimmedTitle.length < 3 || trimmedBody.length < 10) return;
    const nextId = padNumber(observations.length + 1);
    setObservations((current) => [...current, { id: nextId, title: trimmedTitle, body: trimmedBody, selected: true }]);
    setCustomTitle('');
    setCustomBody('');
  }

  function confirmObservations() {
    if (!titleDirty && checked.length > 0) setTitle(checked[0].title);
    if (!descriptionDirty) {
      const composed = composeDescription(checked, location.trim(), assistText);
      setDescription(composed);
    }
    goToPhase('details');
  }

  async function prepareEvidence() {
    if (!file) throw new Error('Add a photo or video as evidence.');
    if (!needsPrivacyPrepare()) return file;
    await photoReadyRef.current;
    const canvas = renderPrivacyCanvas();
    if (!canvas) throw new Error('The privacy-prepared image could not be created.');
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, file.type, 0.92);
    });
    if (!blob) throw new Error('The privacy-prepared image could not be created.');
    return new File([blob], file.name, { type: blob.type, lastModified: Date.now() });
  }

  async function onSave(event) {
    event.preventDefault();
    if (!formRef.current.reportValidity()) return;
    if (!file) {
      setEvidenceError('Add a photo or video as evidence.');
      goToPhase('evidence');
      return;
    }
    if (missingDetails.length > 0) {
      setFormMessage(`Still needed: ${missingDetails.join(', ')}.`);
      setFormError(true);
      goToPhase('details');
      return;
    }
    setSubmitBusy(true);
    setFormMessage('');
    setFormError(false);
    setSessionExpired(false);
    // Function-scoped so the catch block can tell a pre-create expiry
    // apart from the narrow create-then-expire race below.
    let created = null;
    try {
      // Validate the session BEFORE creating anything: a 401 here means the
      // account cannot be billed for a report, so nothing is created and the
      // draft simply waits for sign-in. This also closes the partial-create
      // race (create succeeds, edit 401s) for the common expiry case.
      try {
        await api.trySession();
      } catch (error) {
        if (error?.status === 401) throw error;
        throw error;
      }
      const prepared = await prepareEvidence();
      const data = new FormData();
      data.append('title', title.trim());
      data.append('category', category);
      data.append('description', description.trim());
      if (location.trim()) data.append('location', location.trim());
      data.append('evidence', prepared, prepared.name);
      try {
        created = await api.createReport(data, { loginRedirect: false });
      } catch (error) {
        if (error?.status === 401) throw error;
        throw error;
      }
      let final = null;
      try {
        final = await api.editReport(created.id, {
          title: title.trim(),
          category,
          description: description.trim(),
          location: location.trim() || null,
          observed_date: observedDate || null,
          resident_context: residentContext.trim() || null,
          observations: observations.map((item) => ({ id: item.id, title: item.title, body: item.body, selected: item.selected })),
        }, { loginRedirect: false });
      } catch (error) {
        if (error?.status === 401 && created?.id) {
          // Narrow race: the report was created, then the session died
          // before details saved. Remember the id so resume opens the
          // existing report instead of saving a duplicate.
          try {
            sessionStorage.setItem('proofpath.pendingCreated', String(created.id));
          } catch {
            // Storage failure must never break the reporting flow.
          }
          throw error;
        }
        throw error;
      }
      onSaved(final, prepared);
    } catch (error) {
      if (error?.status === 401) {
        try {
          sessionStorage.setItem('proofpath.sessionExpired', '1');
        } catch {
          // Storage failure must never break the reporting flow.
        }
        setSessionExpired(true);
        setFormMessage(created ? 'Your report was received. Sign in to continue to it — nothing was duplicated.' : 'Your session expired. Please sign in to continue — your draft is preserved.');
        setFormError(true);
      } else {
        setFormMessage(error?.message || 'Something went wrong. Please try again.');
        setFormError(true);
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  const stepIndex = phase === 'observations' ? 1 : phase === 'details' ? 2 : phase === 'review' ? 3 : 0;
  const phaseTitle =
    phase === 'analyzing'
      ? ['Analyzing evidence', 'Preparing suggestions from your selected photo.']
      : phase === 'ready'
        ? ['Ready to review', 'Choose which observations belong in your report.']
        : phase === 'observations'
          ? ['Review observations', 'Select the observations to include in your report.']
          : phase === 'details'
            ? ['Add report details', 'Confirm the location and add context.']
            : phase === 'review'
              ? ['Review report', 'Check the details before saving.']
              : evidenceError
                ? ['Upload failed', 'Choose another image to continue.']
                : ['Upload evidence', 'Add a clear photo of the issue.'];

  const privacySummary = `Photo metadata: ${stripMetadata ? 'remove' : 'keep'}; Identifying details: ${blurDetails ? 'blur' : 'keep'}`;
  const observedLong = formatLongDate(observedDate);
  const reviewMeta = [category, observedLong ? `Observed ${observedLong}` : null].filter(Boolean).join(' · ') || 'Report details';
  const attachmentLabel = file ? (isVideo ? '1 video' : '1 photo') : 'No evidence';
  const confirmLabel = `${attachmentLabel} · ${checked.length} confirmed observation${checked.length === 1 ? '' : 's'}`;

  return (
    <section className="w-flow" aria-labelledby="w-heading" ref={topRef}>
      <h1 id="w-heading">{phaseTitle[0]}</h1>
      <p className="w-sub">{phaseTitle[1]}</p>
      <ol className="w-stepper" aria-label="Report steps">
        {STEPS.map((label, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;
          return (
            <li key={label} className={`${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`.trim()} aria-current={active ? 'step' : undefined}>
              <span className="w-node" aria-hidden="true">{done ? '✓' : index + 1}</span>
              <span className="w-step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      <form ref={formRef} onSubmit={onSave}>
        {(phase === 'evidence') && (
          <>
            {!file && !evidenceError && (
              <label
                className={`w-dropzone${dragging ? ' is-dragging' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
                onDrop={(event) => { event.preventDefault(); setDragging(false); const [dropped] = event.dataTransfer.files; if (dropped) acceptFile(dropped); }}
              >
                <input
                  id="evidence"
                  name="evidence"
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  onChange={(event) => acceptFile(event.target.files[0])}
                />
                <span className="w-drop-title">Drop a photo here</span>
                <span className="w-drop-hint">JPG or PNG</span>
                <span className="w-drop-types">WebP and video (MP4, MOV) also accepted · up to 20 MB</span>
                <span className="w-choose" aria-hidden="true">Choose a photo</span>
              </label>
            )}
            {!file && evidenceError && (
              <div className="w-dropzone is-error" role="alert">
                <p className="w-error-title">We could not read that file</p>
                <p className="w-error-sub">Choose a clear JPG or PNG photo to try again.</p>
                <button
                  className="w-choose"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose another photo
                </button>
                <input
                  id="evidence"
                  name="evidence"
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  hidden
                  onChange={(event) => acceptFile(event.target.files[0])}
                />
              </div>
            )}
            {file && (
              <div className="w-evidence-card">
                <div className="w-evidence-media">
                  {!isVideo && (
                    <canvas
                      ref={canvasRef}
                      aria-label={blurDetails ? 'Evidence photo. Drag to blur identifying details.' : 'Selected evidence photo'}
                      className={`w-blur-canvas${blurDetails ? ' is-active' : ''}`}
                      onPointerDown={(event) => {
                        if (!blurDetails || !loadedPhotoRef.current) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const path = [imagePoint(event)];
                        activeRedactionRef.current = path;
                        redactionPathsRef.current.push(path);
                        drawPhotoPreview();
                        refreshDisplayPreview();
                      }}
                      onPointerMove={(event) => {
                        if (!activeRedactionRef.current) return;
                        activeRedactionRef.current.push(imagePoint(event));
                        drawPhotoPreview();
                      }}
                      onPointerUp={() => { activeRedactionRef.current = null; refreshDisplayPreview(); }}
                      onPointerCancel={() => { activeRedactionRef.current = null; refreshDisplayPreview(); }}
                    />
                  )}
                  {isVideo && previewUrl && <video src={previewUrl} controls playsInline />}
                </div>
                <div className="w-evidence-info">
                  <h2 className="w-filename">{file.name}</h2>
                  <p className="w-ready">Ready to analyze</p>
                  <p className="w-stays">Your photo will stay attached to the report.</p>
                  <div className="w-evidence-buttons">
                    <button className="w-choose" type="button" onClick={() => fileInputRef.current?.click()}>
                      Choose another photo
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      hidden
                      onChange={(event) => acceptFile(event.target.files[0])}
                    />
                    <button className="w-link" type="button" onClick={removePhoto}>
                      Remove photo
                    </button>
                  </div>
                  {!isVideo && blurDetails && (
                    <p className="w-blur-row">
                      <span>{blurHint}</span>
                      <button className="w-link" type="button" onClick={clearRedactions}>
                        Clear blur marks
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}
            <PrivacyCard
              stripMetadata={stripMetadata}
              onStripChange={setStripMetadata}
              blurDetails={blurDetails}
              onBlurChange={setBlurDetails}
              disabled={isVideo}
            />
            {isVideo && (
              <p className="w-video-note">Video files are attached unchanged. Metadata removal and blurring apply to photos only.</p>
            )}
            {analysisError && (
              <p className="w-form-error" role="alert">{analysisError}</p>
            )}
            <div className="w-foot">
              <button className="w-link" type="button" onClick={onCancel}>
                Back to reports
              </button>
              <button className="w-primary" type="button" disabled={!file} onClick={startAnalysis}>
                Analyze photo <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {phase === 'analyzing' && (
          <>
            <div className="w-status-card">
              <span className="w-status-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M11 6.5V11l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <h2>Analyzing your photo…</h2>
              <p>Keep this page open while we prepare observations.</p>
            </div>
            <p className="w-privacy-line">
              <strong>Privacy options</strong>
              <span>{privacySummary}</span>
            </p>
            <div className="w-foot">
              <button className="w-link" type="button" onClick={cancelAnalysis}>
                Cancel
              </button>
              <button className="w-primary" type="button" disabled>
                Analyzing photo…
              </button>
            </div>
          </>
        )}

        {phase === 'ready' && (
          <>
            <div className="w-status-card">
              <span className="w-status-icon is-ok" aria-hidden="true">✓</span>
              <h2>Your photo is ready to review</h2>
              <p>{`${observations.length} suggestion${observations.length === 1 ? '' : 's'} found. You decide what to include.`}</p>
              {analysisNote && <p className="w-note">{analysisNote}</p>}
            </div>
            <p className="w-privacy-line">
              <strong>Privacy options</strong>
              <span>{privacySummary}</span>
            </p>
            <div className="w-foot">
              <button className="w-link" type="button" onClick={() => goToPhase('evidence')}>
                Back to photo
              </button>
              <button className="w-primary" type="button" onClick={() => goToPhase('observations')}>
                Review observations <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {phase === 'observations' && (
          <>
            <AiBanner aiStatus={aiStatus} segmentationOn={segmentationOn} reasoningOn={reasoningOn} />
            <div className="w-obs-layout">
              <div className="w-photo-card">
                <div className="w-photo-head">
                  <span className="w-photo-title">▦ Photo 01</span>
                  {masks.length > 0 && (
                    <button className="w-link" type="button" onClick={() => setShowOverlay((value) => !value)}>
                      {showOverlay ? 'View original' : 'View overlay'}
                    </button>
                  )}
                </div>
                <div className="w-overlay-wrap">
                  {(displayUrl || previewUrl) && !isVideo && (
                    <img src={displayUrl || previewUrl} alt="Evidence with observation outlines" />
                  )}
                  {(displayUrl || previewUrl) && isVideo && <video src={displayUrl || previewUrl} controls playsInline />}
                  {showOverlay && masks.length > 0 && !isVideo && masks.map((mask, index) => {
                    const [x, y, w, h] = mask.bbox || [0, 0, 0, 0];
                    return (
                      <span
                        key={index}
                        className="w-region"
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          width: `${w * 100}%`,
                          height: `${h * 100}%`,
                          backgroundColor: OVERLAY_FILLS[index % OVERLAY_FILLS.length],
                        }}
                      >
                        <span className="w-chip">{padNumber(index + 1)}</span>
                      </span>
                    );
                  })}
                </div>
                <p className="w-photo-foot">
                  <span>{file ? file.name : ''}</span>
                  {showOverlay && masks.length > 0 && !isVideo && <span>Numbers match the suggestions.</span>}
                </p>
              </div>
              <div className="w-suggest">
                <div className="w-suggest-head">
                  <h2>Suggested observations</h2>
                  <span>{`${checked.length} observation${checked.length === 1 ? '' : 's'} selected`}</span>
                </div>
                <p className="w-suggest-sub">Only checked observations appear in your report.</p>
                {observations.length === 0 && (
                  <p className="w-empty-obs">No suggestions for this photo yet. Add your own observation below — only checked observations appear in your report.</p>
                )}
                <ul className="w-obs-list">
                  {observations.map((item) => (
                    <li key={item.id} className={`w-obs${item.selected ? ' is-checked' : ''}`}>
                      <label>
                        <input type="checkbox" checked={item.selected} onChange={() => toggleObservation(item.id)} />
                        <span className="w-obs-id">{item.id}</span>
                        <span className="w-obs-text">
                          <strong>{item.title}</strong>
                          <span>{item.body}</span>
                        </span>
                        <span className="w-box" aria-hidden="true">{item.selected ? '✓' : ''}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="w-custom-obs">
                  <h3>Add your own observation</h3>
                  <label className="w-field">
                    <span>Title</span>
                    <input value={customTitle} maxLength={120} placeholder="e.g. Blocked drain inlet" onChange={(event) => setCustomTitle(event.target.value)} />
                  </label>
                  <label className="w-field">
                    <span>What did you see? (10+ characters)</span>
                    <textarea value={customBody} maxLength={2000} rows={3} placeholder="Describe only what you can verify from the evidence." onChange={(event) => setCustomBody(event.target.value)} />
                  </label>
                  <button className="w-secondary" type="button" disabled={customTitle.trim().length < 3 || customBody.trim().length < 10} onClick={addCustomObservation}>
                    Add observation
                  </button>
                </div>
                {assistText && (
                  <div className="w-assist">
                    <p className="w-assist-head">
                      <strong>Suggested wording</strong>
                      <span>{assistProvider === 'unavailable' ? 'Unavailable' : assistProvider || 'AI suggestion'}</span>
                    </p>
                    <p>{assistText}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="w-foot">
              <button className="w-link" type="button" onClick={() => goToPhase('evidence')}>
                Back to evidence
              </button>
              <button className="w-primary" type="button" onClick={confirmObservations}>
                Confirm &amp; continue <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {phase === 'details' && (
          <>
            <div className="w-details-layout">
              <div className="w-details-form">
                <label className="w-field">
                  <span>Short title *</span>
                  <input
                    name="title"
                    minLength={3}
                    maxLength={120}
                    required
                    placeholder="e.g. Uneven road surface near the footbridge"
                    value={title}
                    onChange={(event) => { setTitle(event.target.value); setTitleDirty(true); }}
                  />
                </label>
                <label className="w-field">
                  <span>Where is the issue? *</span>
                  <input
                    name="location"
                    maxLength={180}
                    required
                    placeholder="Mabini Street, near the footbridge"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </label>
                <div className="w-field-row">
                  <label className="w-field">
                    <span>Issue category *</span>
                    <select name="category" required value={category} onChange={(event) => setCategory(event.target.value)}>
                      <option value="" disabled>Select a category</option>
                      {CATEGORIES.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="w-field">
                    <span>When did you notice it?</span>
                    <input
                      name="observed_date"
                      type="date"
                      value={observedDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(event) => setObservedDate(event.target.value)}
                    />
                  </label>
                </div>
                <label className="w-field">
                  <span>What else should someone know?</span>
                  <textarea
                    name="resident_context"
                    rows={4}
                    maxLength={2000}
                    placeholder="I noticed this area while walking near the footbridge this morning. The affected surface is on the road beside the pedestrian crossing."
                    value={residentContext}
                    onChange={(event) => setResidentContext(event.target.value)}
                  />
                </label>
                <p className="w-hint">Include only what you observed.</p>
                <label className="w-field">
                  <span>Description *</span>
                  <textarea
                    name="description"
                    rows={4}
                    minLength={10}
                    maxLength={2000}
                    required
                    placeholder="Describe the issue for the report. Review all suggested wording before saving."
                    value={description}
                    onChange={(event) => { setDescription(event.target.value); setDescriptionDirty(true); }}
                  />
                </label>
              </div>
              <aside className="w-evidence-side">
                <h2>Your evidence</h2>
                <div className="w-side-media">
                  {(displayUrl || previewUrl) && !isVideo && <img src={displayUrl || previewUrl} alt="Evidence thumbnail" />}
                  {(displayUrl || previewUrl) && isVideo && <video src={displayUrl || previewUrl} controls playsInline />}
                </div>
                <p className="w-side-row">
                  <strong>{attachmentLabel}</strong>
                  <span className="w-pill">Reviewed</span>
                </p>
                <p className="w-side-count">{`${checked.length} observation${checked.length === 1 ? '' : 's'} selected`}</p>
              </aside>
            </div>
            <div className="w-foot">
              <button className="w-link" type="button" onClick={() => goToPhase('observations')}>
                Back to observations
              </button>
              <button className="w-primary" type="button" onClick={() => goToPhase('review')}>
                Preview report <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        )}

        {phase === 'review' && (
          <>
            <div className="w-review-layout">
              <article className="w-review-doc">
                <h2>{title.trim() || 'Untitled report'}</h2>
                <p className="w-review-meta">{reviewMeta}</p>
                <div className="w-rule" />
                <h3>Description</h3>
                <p>{description.trim()}</p>
                {residentContext.trim() && (
                  <>
                    <h3>Resident context</h3>
                    <p className="w-quote">“{residentContext.trim()}”</p>
                  </>
                )}
                <div className="w-rule" />
                <p className="w-review-foot">▦ {confirmLabel}</p>
              </article>
              <aside className="w-before">
                <h2>Before you save</h2>
                <p className="w-before-label">Location</p>
                <p className="w-before-value">{location.trim() || 'Not provided'}</p>
                <p className="w-before-label">Supporting evidence</p>
                <p className="w-before-value">{`${attachmentLabel} · ${checked.length} observation${checked.length === 1 ? '' : 's'}`}</p>
                {detailsComplete ? (
                  <p className="w-complete">ⓘ Required details complete</p>
                ) : (
                  <p className="w-incomplete">ⓘ Still needed: {missingDetails.join(', ')}</p>
                )}
                <button className="w-secondary" type="button" onClick={() => goToPhase('details')}>
                  Edit the details
                </button>
                <button className="w-link" type="button" onClick={() => goToPhase('observations')}>
                  Review the evidence
                </button>
              </aside>
            </div>
            <div className="w-foot">
              <button className="w-link" type="button" onClick={() => goToPhase('details')}>
                Back to details
              </button>
              {signedIn ? (
                <button className="w-primary" type="submit" disabled={submitBusy}>
                  {submitBusy ? 'Saving…' : 'Save report'}
                </button>
              ) : (
                <button
                  className="w-primary"
                  type="button"
                  onClick={() => {
                    if (onRequireAccount) {
                      onRequireAccount(collectDraft('review'));
                      return;
                    }
                    window.location.assign('/login');
                  }}
                >
                  Sign in to save report <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </>
        )}

        {formMessage && (
          <p className={`w-form-error${formError ? '' : ' is-ok'}`} role="status" aria-live="polite">
            {formMessage}
          </p>
        )}
        {sessionExpired && onSignIn && (
          <p className="w-expired-actions">
            <button type="button" className="w-primary" onClick={() => onSignIn()}>
              Sign in to continue
            </button>
          </p>
        )}
      </form>
      {pendingFile && (
        <ConfirmDialog
          title="Replace this photo?"
          body="Replacing the evidence discards its analysis, observations, and edits. This cannot be undone."
          confirmLabel="Replace photo"
          safeLabel="Keep photo"
          onConfirm={() => { const next = pendingFile; setPendingFile(null); applyFile(next); }}
          onClose={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
        />
      )}
    </section>
  );
}

function PrivacyCard({ stripMetadata, onStripChange, blurDetails, onBlurChange, disabled }) {
  return (
    <div className="w-privacy">
      <p className="w-privacy-title">Privacy settings</p>
      <div className="w-privacy-opt">
        <div>
          <strong>Remove photo metadata</strong>
          <span>Keep location details under your control.</span>
        </div>
        <button
          className={`w-switch${stripMetadata ? ' is-on' : ''}`}
          type="button"
          role="switch"
          aria-checked={stripMetadata}
          aria-label="Remove photo metadata"
          disabled={disabled}
          onClick={() => onStripChange(!stripMetadata)}
        >
          <span />
        </button>
      </div>
      <div className="w-privacy-opt">
        <div>
          <strong>Blur identifying details</strong>
          <span>Review any faces or number plates.</span>
        </div>
        <button
          className={`w-switch${blurDetails ? ' is-on' : ''}`}
          type="button"
          role="switch"
          aria-checked={blurDetails}
          aria-label="Blur identifying details"
          disabled={disabled}
          onClick={() => onBlurChange(!blurDetails)}
        >
          <span />
        </button>
      </div>
    </div>
  );
}

function AiBanner({ aiStatus, segmentationOn, reasoningOn }) {
  return (
    <div className="w-ai-banner" role="status">
      <span className="w-ai-mark" aria-hidden="true">i</span>
      <p>
        {!aiStatus && (
          <>
            <strong>AI status unavailable.</strong> Your words remain your own; please avoid guessing at cause or severity.
          </>
        )}
        {aiStatus && !segmentationOn && !reasoningOn && (
          <>
            <strong>AI suggestions are not connected.</strong> ProofPath does not analyze this image. Your words remain your own; please avoid guessing at cause or severity.
          </>
        )}
        {aiStatus && (segmentationOn || reasoningOn) && (
          <>
            <strong>
              AI connected: {[segmentationOn && 'object outlines', reasoningOn && 'report wording help'].filter(Boolean).join(' and ')}.
            </strong>{' '}
            Suggestions are unverified — your words remain your own; please avoid guessing at cause or severity.
          </>
        )}
      </p>
    </div>
  );
}
