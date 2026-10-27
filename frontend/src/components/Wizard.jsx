import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES, api } from '../api.js';

const STEP_LABELS = ['Evidence', 'Observation', 'Details', 'Review'];

export default function Wizard({ aiStatus, canCreate, onSaved, onCancel }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [stripMetadata, setStripMetadata] = useState(true);
  const [blurActive, setBlurActive] = useState(false);
  const [privacyHelp, setPrivacyHelp] = useState('Photo metadata can reveal where an image was taken. Video metadata is not removed.');
  const [dragging, setDragging] = useState(false);
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [segmentMessage, setSegmentMessage] = useState('Outlines highlight relevant parts of the photo. They never change your words.');
  const [segmentMasks, setSegmentMasks] = useState([]);
  const [segmentsVisible, setSegmentsVisible] = useState(false);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [assist, setAssist] = useState(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [formError, setFormError] = useState(false);

  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const segmentCanvasRef = useRef(null);
  const descriptionRef = useRef(null);
  const sectionRefs = useRef({});
  const topRef = useRef(null);
  const loadedPhotoRef = useRef(null);
  const photoReadyRef = useRef(Promise.resolve());
  const redactionPathsRef = useRef([]);
  const activeRedactionRef = useRef(null);
  const blurActiveRef = useRef(false);

  const isVideo = Boolean(file && file.type.startsWith('video/'));
  const segmentationOn = Boolean(aiStatus?.segmentation?.configured);
  const reasoningOn = Boolean(aiStatus?.reasoning?.configured);

  const completeCount = useMemo(
    () => [Boolean(file), Boolean(category), Boolean(title.trim()), Boolean(description.trim())].filter(Boolean).length,
    [file, category, title, description]
  );

  useEffect(() => {
    blurActiveRef.current = blurActive;
  }, [blurActive]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function drawPhotoPreview() {
    const canvas = canvasRef.current;
    const photo = loadedPhotoRef.current;
    if (!canvas || !photo) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    const paths = redactionPathsRef.current;
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
    redactionPathsRef.current = [];
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
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setEvidenceError('This image could not be previewed. Choose a different photo.');
        resolve();
      };
    });
    photo.src = previewUrl;
    setPrivacyHelp('Turn on the blur tool, then drag over identifying details in the photo.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, previewUrl]);

  function acceptFile(next) {
    setEvidenceError('');
    setSegmentMasks([]);
    setSegmentsVisible(false);
    setAssist(null);
    if (!next) return;
    if (!ACCEPTED_TYPES.has(next.type)) {
      setEvidenceError('Choose a JPG, PNG, WebP, MP4, or MOV file.');
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setEvidenceError('Evidence must be smaller than 20 MB.');
      return;
    }
    redactionPathsRef.current = [];
    activeRedactionRef.current = null;
    setBlurActive(false);
    setFormMessage('');
    setFile(next);
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
    setPrivacyHelp('Blur marks cleared. Turn on the blur tool to mark details.');
  }

  async function prepareEvidence() {
    if (!file.type.startsWith('image/')) return file;
    await photoReadyRef.current;
    if (!stripMetadata && redactionPathsRef.current.length === 0) return file;
    const blob = await new Promise((resolve) => {
      canvasRef.current.toBlob(resolve, file.type, 0.92);
    });
    if (!blob) throw new Error('The privacy-prepared image could not be created.');
    return new File([blob], file.name, { type: blob.type, lastModified: Date.now() });
  }

  function goToStep(next) {
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function goNext(next) {
    const section = sectionRefs.current[step];
    const invalid = section
      ? [...section.querySelectorAll('input[required], select[required], textarea[required]')].find((field) => !field.checkValidity())
      : null;
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    goToStep(next);
  }

  async function runSegmentation() {
    if (!file) {
      setSegmentMessage('Choose a photo first.');
      return;
    }
    if (file.type.startsWith('video/')) {
      setSegmentMessage('Outlines support photos only.');
      return;
    }
    setSegmentBusy(true);
    setSegmentMessage('Finding objects…');
    try {
      await photoReadyRef.current;
      if (!loadedPhotoRef.current) throw new Error('The photo preview is not ready yet.');
      const result = await api.segment(file);
      const masks = result.masks || [];
      setSegmentMasks(masks);
      if (masks.length === 0) {
        setSegmentsVisible(false);
        setSegmentMessage('No distinct objects found. Your description still matters most.');
        return;
      }
      setSegmentsVisible(true);
      setSegmentMessage(`${masks.length} region${masks.length === 1 ? '' : 's'} outlined. Verify each one against the photo.`);
    } catch (error) {
      setSegmentMessage(error.message || 'Segmentation failed.');
    } finally {
      setSegmentBusy(false);
    }
  }

  useEffect(() => {
    if (segmentsVisible && segmentMasks.length > 0) drawSegments(segmentMasks);
  }, [segmentsVisible, segmentMasks]);

  function drawSegments(masks) {
    const photo = loadedPhotoRef.current;
    const canvas = segmentCanvasRef.current;
    if (!photo || !canvas) return;
    const scale = Math.min(1, 1200 / Math.max(photo.naturalWidth, photo.naturalHeight));
    canvas.width = Math.round(photo.naturalWidth * scale);
    canvas.height = Math.round(photo.naturalHeight * scale);
    const context = canvas.getContext('2d');
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    context.lineWidth = Math.max(2, canvas.width * 0.004);
    context.font = `${Math.max(12, Math.round(canvas.width * 0.022))}px sans-serif`;
    for (const mask of masks) {
      const [x, y, w, h] = mask.bbox;
      const left = x * canvas.width;
      const top = y * canvas.height;
      const width = w * canvas.width;
      const height = h * canvas.height;
      context.strokeStyle = '#244d3c';
      context.strokeRect(left, top, width, height);
      context.fillStyle = 'rgba(36, 77, 60, 0.85)';
      const label = `${mask.label} ${Math.round((mask.score || 0) * 100)}%`;
      const textWidth = context.measureText(label).width;
      context.fillRect(left, Math.max(0, top - 22), textWidth + 12, 22);
      context.fillStyle = '#ffffff';
      context.fillText(label, left + 6, Math.max(15, top - 6));
    }
  }

  async function runAssist() {
    const observation = description.trim();
    if (observation.length < 10) {
      descriptionRef.current?.focus();
      descriptionRef.current?.reportValidity();
      return;
    }
    setAssistBusy(true);
    try {
      const result = await api.assist({
        observation,
        title: title.trim() || null,
        category: category || null,
        location: location.trim() || null,
      });
      setAssist(result);
    } catch (error) {
      setAssist({ provider: 'unavailable', structured_description: error.message || 'Report help failed.', missing_info: [], followup_questions: [], note: '' });
    } finally {
      setAssistBusy(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!formRef.current.reportValidity()) return;
    if (!file) {
      setEvidenceError('Add a photo or video as evidence.');
      goToStep(1);
      return;
    }
    setSubmitBusy(true);
    setFormMessage('');
    setFormError(false);
    try {
      const prepared = await prepareEvidence();
      const data = new FormData();
      data.append('title', title.trim());
      data.append('category', category);
      data.append('description', description.trim());
      if (location.trim()) data.append('location', location.trim());
      data.append('evidence', prepared, prepared.name);
      const report = await api.createReport(data);
      onSaved(report, file);
    } catch (error) {
      setFormMessage(error.message || 'Something went wrong. Please try again.');
      setFormError(true);
    } finally {
      setSubmitBusy(false);
    }
  }

  const reviewMeta = [category, location.trim()].filter(Boolean).join(' · ') || 'Report details';

  function renderPreview(target) {
    if (file && previewUrl) {
      if (file.type.startsWith('video/')) {
        return <video src={previewUrl} controls playsInline />;
      }
      return <img src={previewUrl} alt={target === 'observation' ? 'Selected evidence preview' : 'Evidence preview'} />;
    }
    return <span>Evidence preview</span>;
  }

  return (
    <section className="report-compose" aria-labelledby="compose-heading" ref={topRef}>
      <div className="wizard-heading">
        <div>
          <p className="eyebrow">NEW COMMUNITY REPORT</p>
          <h1 id="compose-heading">Start with what you saw</h1>
        </div>
        <button className="wizard-close" type="button" aria-label="Return to reports" onClick={onCancel}>
          ×
        </button>
      </div>
      <ol className="wizard-progress" aria-label="Report steps">
        {STEP_LABELS.map((label, index) => {
          const number = index + 1;
          const current = number === step;
          return (
            <li key={label} className={`${current ? 'is-current' : ''} ${number < step ? 'is-complete' : ''}`.trim()} aria-current={current ? 'step' : undefined}>
              <span>{String(number).padStart(2, '0')}</span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      <form ref={formRef} onSubmit={onSubmit}>
        <section className="wizard-page" aria-labelledby="evidence-heading" ref={(el) => { sectionRefs.current[1] = el; }} hidden={step !== 1}>
            <div className="wizard-page-heading">
              <span className="step-kicker">STEP 1 OF 4</span>
              <h2 id="evidence-heading">Add evidence</h2>
              <p>Choose a clear photo or video of the issue.</p>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="evidence">
                Photo or video <span className="optional">Required</span>
              </label>
              <label
                className={`upload-zone${dragging ? ' is-dragging' : ''}`}
                htmlFor="evidence"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const [dropped] = event.dataTransfer.files;
                  if (dropped) acceptFile(dropped);
                }}
              >
                <input
                  id="evidence"
                  name="evidence"
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  required={!file}
                  onChange={(event) => acceptFile(event.target.files[0])}
                />
                {!file && (
                  <span className="upload-content">
                    <span className="upload-icon" aria-hidden="true">
                      +
                    </span>
                    <span className="upload-title">Drop a photo or video here</span>
                    <span className="upload-hint">JPG, PNG, WebP, MP4, or MOV · up to 20 MB</span>
                    <span className="browse-link">Choose a file</span>
                  </span>
                )}
                {file && (
                  <span className="preview-wrap">
                    {!isVideo && (
                      <canvas
                        ref={canvasRef}
                        aria-label="Evidence preview. Mark areas to blur identifying details."
                        className={blurActive ? 'is-blur-active' : ''}
                        onPointerDown={(event) => {
                          if (!blurActiveRef.current || !loadedPhotoRef.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          const path = [imagePoint(event)];
                          activeRedactionRef.current = path;
                          redactionPathsRef.current.push(path);
                          drawPhotoPreview();
                        }}
                        onPointerMove={(event) => {
                          if (!activeRedactionRef.current) return;
                          activeRedactionRef.current.push(imagePoint(event));
                          drawPhotoPreview();
                        }}
                        onPointerUp={() => {
                          activeRedactionRef.current = null;
                        }}
                        onPointerCancel={() => {
                          activeRedactionRef.current = null;
                        }}
                        onClick={(event) => {
                          if (blurActiveRef.current) {
                            event.preventDefault();
                            event.stopPropagation();
                          }
                        }}
                      />
                    )}
                    {isVideo && <video ref={videoRef} src={previewUrl} controls playsInline />}
                    <span className="preview-change">Choose a different file</span>
                  </span>
                )}
              </label>
              {file && !isVideo && (
                <div className="privacy-tools">
                  <div className="privacy-heading">
                    <strong>Your evidence, protected</strong>
                    <span>Privacy settings</span>
                  </div>
                  <div className="privacy-toolbar">
                    <label className="privacy-option" htmlFor="strip-metadata">
                      <input id="strip-metadata" type="checkbox" checked={stripMetadata} onChange={(event) => setStripMetadata(event.target.checked)} /> Remove photo metadata
                    </label>
                    <button
                      className="privacy-tool"
                      type="button"
                      aria-pressed={String(blurActive)}
                      onClick={() => {
                        setBlurActive((value) => {
                          const next = !value;
                          setPrivacyHelp(next ? 'Drag over faces, plates, or other identifying details to blur them.' : 'Blurred areas are included in the saved evidence image.');
                          return next;
                        });
                      }}
                    >
                      {blurActive ? 'Done marking details' : 'Mark details to blur'}
                    </button>
                    <button className="privacy-tool privacy-tool-quiet" type="button" onClick={clearRedactions}>
                      Clear marks
                    </button>
                  </div>
                  <p>{privacyHelp}</p>
                </div>
              )}
              <p className="privacy-disclaimer">Photos are re-encoded only if metadata removal or blurring is selected. Video metadata is not modified.</p>
              <p className="field-error" aria-live="polite">
                {evidenceError}
              </p>
            </div>
            <div className="wizard-actions">
              <button className="text-link back-to-journal" type="button" onClick={onCancel}>
                Back to reports
              </button>
              <button className="submit-button" type="button" onClick={() => goNext(2)}>
                Continue <span aria-hidden="true">→</span>
              </button>
            </div>
        </section>

        <section className="wizard-page" aria-labelledby="observation-heading" ref={(el) => { sectionRefs.current[2] = el; }} hidden={step !== 2}>
            <div className="wizard-page-heading">
              <span className="step-kicker">STEP 2 OF 4</span>
              <h2 id="observation-heading">Review your observation</h2>
              <p>Describe only what you can personally verify from the evidence.</p>
            </div>
            <div className="observation-note">
              <span className="notice-mark" aria-hidden="true">
                i
              </span>
              <p>
                {!aiStatus && (
                  <>
                    <strong>AI status unavailable.</strong> Your words remain your own; please avoid guessing at cause or severity.
                  </>
                )}
                {aiStatus && !segmentationOn && !reasoningOn && (
                  <>
                    <strong>AI suggestions are not connected.</strong> ProofPath does not analyze this image. Your words remain your own; please avoid
                    guessing at cause or severity.
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
            <div className="observation-layout">
              <div className="observation-evidence">
                <div className="privacy-heading">
                  <strong>Your evidence</strong>
                  <span>Photo preview</span>
                </div>
                <div className="summary-media">{renderPreview('observation')}</div>
                <div className="ai-segment-row">
                  <button className="privacy-tool" type="button" disabled={!canCreate || !segmentationOn || segmentBusy} title={!segmentationOn ? 'Segmentation is not configured.' : ''} onClick={runSegmentation}>
                    Find objects in photo
                  </button>
                  {segmentMasks.length > 0 && (
                    <button className="privacy-tool privacy-tool-quiet" type="button" onClick={() => setSegmentsVisible((value) => !value)}>
                      {segmentsVisible ? 'Hide outlines' : 'Show outlines'}
                    </button>
                  )}
                </div>
                <p className="field-hint">{segmentMessage}</p>
                {segmentsVisible && segmentMasks.length > 0 && (
                  <div id="segment-result">
                    <canvas ref={segmentCanvasRef} aria-label="Photo with AI outlines" />
                    <div className="segment-labels">
                      {segmentMasks.map((mask, index) => (
                        <span key={index}>
                          {mask.label} · {Math.round((mask.score || 0) * 100)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="field-hint">Review the image as you write your observation.</p>
              </div>
              <div className="field-group observation-field">
                <label className="field-label" htmlFor="description">
                  What did you observe? <span className="optional">Required · 10–2000 characters</span>
                </label>
                <textarea
                  id="description"
                  name="description"
                  ref={descriptionRef}
                  minLength={10}
                  maxLength={2000}
                  rows={7}
                  placeholder="Describe what you can see, when you noticed it, and how it affects the area."
                  required
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <span className="character-count">{description.length} / 2000</span>
                <button className="secondary-action assist-button" type="button" disabled={!canCreate || assistBusy} onClick={runAssist}>
                  {assistBusy ? 'Getting help…' : 'Get report help'}
                </button>
                {assist && (
                  <div className="ai-assist">
                    <div className="privacy-heading">
                      <strong>Suggested wording</strong>
                      <span>{assist.provider === 'local-fallback' ? 'Local checklist' : assist.provider === 'unavailable' ? 'Unavailable' : 'AI suggestion'}</span>
                    </div>
                    <p>{assist.structured_description}</p>
                    {assist.provider !== 'unavailable' && (
                      <div className="assist-actions">
                        <button
                          className="privacy-tool"
                          type="button"
                          onClick={() => {
                            setDescription(assist.structured_description);
                            setAssist(null);
                            descriptionRef.current?.focus();
                          }}
                        >
                          Use suggestion
                        </button>
                        <button className="privacy-tool privacy-tool-quiet" type="button" onClick={() => setAssist(null)}>
                          Keep my words
                        </button>
                      </div>
                    )}
                    <div>
                      {[...(assist.missing_info || []), ...(assist.followup_questions || [])].map((item, index) => (
                        <p key={index}>• {item}</p>
                      ))}
                      {assist.suggested_category && (
                        <p>
                          Suggested category: {assist.suggested_category}{' '}
                          <button
                            type="button"
                            className="privacy-tool"
                            onClick={() => {
                              setCategory(assist.suggested_category);
                            }}
                          >
                            Use category
                          </button>
                        </p>
                      )}
                    </div>
                    <p className="field-hint">{assist.note || ''}</p>
                  </div>
                )}
                <p className="field-hint">Only checked observations appear in your report—here, that means only the details you choose to write.</p>
              </div>
            </div>
            <div className="wizard-actions">
              <button className="text-link" type="button" onClick={() => goToStep(1)}>
                ← Back to evidence
              </button>
              <button className="submit-button" type="button" onClick={() => goNext(3)}>
                Continue <span aria-hidden="true">→</span>
              </button>
            </div>
        </section>

        <section className="wizard-page" aria-labelledby="details-heading" ref={(el) => { sectionRefs.current[3] = el; }} hidden={step !== 3}>
            <div className="wizard-page-heading">
              <span className="step-kicker">STEP 3 OF 4</span>
              <h2 id="details-heading">Add report details</h2>
              <p>Confirm the location and add context that only you know.</p>
            </div>
            <div className="details-layout">
              <div className="details-fields">
                <div className="field-group">
                  <label className="field-label" htmlFor="title">
                    Short title <span className="optional">Required</span>
                  </label>
                  <input id="title" name="title" minLength={3} maxLength={120} placeholder="e.g. Uneven road surface near the footbridge" required value={title} onChange={(event) => setTitle(event.target.value)} />
                </div>
                <div className="form-grid">
                  <div className="field-group">
                    <label className="field-label" htmlFor="category">
                      Issue type
                    </label>
                    <select id="category" name="category" required value={category} onChange={(event) => setCategory(event.target.value)}>
                      <option value="" disabled>
                        Select a category
                      </option>
                      {CATEGORIES.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor="location">
                      Location <span className="optional">Optional</span>
                    </label>
                    <input id="location" name="location" maxLength={180} placeholder="Street or nearby landmark" value={location} onChange={(event) => setLocation(event.target.value)} />
                  </div>
                </div>
              </div>
              <aside className="evidence-summary">
                <p className="eyebrow">YOUR EVIDENCE</p>
                <div className="summary-media">{renderPreview('details')}</div>
                <p className="summary-evidence-name">{file ? file.name : ''}</p>
                <p className="summary-evidence-state">Privacy choices stay under your control.</p>
              </aside>
            </div>
            <div className="completion-check">
              <div className="completion-heading">
                <span className="field-label">Required details</span>
                <span className="completion-count">
                  {completeCount} of 4 complete
                </span>
              </div>
              <progress max={4} value={completeCount} aria-label="Required report details completed" />
            </div>
            <div className="wizard-actions">
              <button className="text-link" type="button" onClick={() => goToStep(2)}>
                ← Back to observation
              </button>
              <button className="submit-button" type="button" onClick={() => goNext(4)}>
                Preview report <span aria-hidden="true">→</span>
              </button>
            </div>
        </section>

        <section className="wizard-page" aria-labelledby="review-heading" ref={(el) => { sectionRefs.current[4] = el; }} hidden={step !== 4}>
            <div className="wizard-page-heading">
              <span className="step-kicker">STEP 4 OF 4</span>
              <h2 id="review-heading">Review your report</h2>
              <p>Check the details before saving.</p>
            </div>
            <div className="review-layout">
              <article className="review-document">
                <h3>{title.trim() || 'Untitled report'}</h3>
                <p className="review-meta">{reviewMeta}</p>
                <div className="review-divider"></div>
                <h4>Description</h4>
                <p>{description.trim()}</p>
                <div className="review-divider"></div>
                <div className="review-evidence-block">
                  <div className="summary-media">{renderPreview('review')}</div>
                  <p>{file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB` : 'No evidence selected'}</p>
                </div>
              </article>
              <aside className="review-checklist">
                <p className="eyebrow">BEFORE YOU SAVE</p>
                <h3>Report checklist</h3>
                <ul>
                  <li>
                    <span>✓</span> Evidence attached
                  </li>
                  <li>
                    <span>✓</span> Your observation included
                  </li>
                  <li>
                    <span>✓</span> Required details complete
                  </li>
                </ul>
                <p className="status-explainer">Reports are saved as drafts. You can update the status after sending the report through your chosen channel.</p>
              </aside>
            </div>
            <div className="wizard-actions">
              <button className="text-link" type="button" onClick={() => goToStep(3)}>
                ← Back to details
              </button>
              <button className="submit-button" type="submit" disabled={submitBusy}>
                <span>{submitBusy ? 'Saving...' : 'Save report'}</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
        </section>
        <p className={`form-message${formError ? ' is-error' : ''}`} role="status" aria-live="polite">
          {formMessage}
        </p>
      </form>
    </section>
  );
}
