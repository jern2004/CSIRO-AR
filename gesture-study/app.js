// app.js - Main study logic with P1-G → P1-E → P2-G flow

import MediaPipeTracker from './mediapipe-tracker.js';

// ============================================================================
// STUDY CONFIGURATION - Three Phase Lists
// ============================================================================

// P1-G: Phase 1 Gestures (main questions with gestures)
const P1G_ITEMS = [
    { id: 'unc_1', text: 'How do you feel about this semester', type: 'unconstrained' },
    { id: 'unc_2', text: 'How do you feel about your workload this week', type: 'unconstrained' },
    { id: 'unc_3', text: 'How do you feel about our club\'s final event', type: 'unconstrained' },
    { id: 'unc_4', text: 'How do you feel today', type: 'unconstrained' },
    { id: 'unc_5', text: 'How do you feel about using hand gestures in apps', type: 'unconstrained' },
    { id: 'unc_6', text: 'How do you feel about your energy level right now', type: 'unconstrained' }
];

// P1-E: Phase 1 Explicit (SAME questions, explicit buttons only)
const P1E_ITEMS = P1G_ITEMS; // Exact same for 1:1 pairing

// P2-G: Phase 2 Gesture spectrum (chill → hesitant)
const P2G_ITEMS = [
    { id: 'spec_chill_1', text: 'What do you think of MCS".', type: 'spectrum' },
    { id: 'spec_chill_2', text: 'How do you feel about your overall experience in MCS this year?', type: 'spectrum' },
    { id: 'spec_neutral', text: 'How do you feel about taking on more responsibilities in MCS next semester?', type: 'spectrum' },
    { id: 'spec_neutral', text: 'How do you feel about how well the committees have worked together this year?', type: 'spectrum' },
    { id: 'spec_hes_1', text: 'Some members could’ve contributed more.', type: 'spectrum' },
    { id: 'spec_hes_2', text: 'Do you think the current directors deserved their roles?', type: 'spectrum' },
    { id: 'spec_hes_3', text: 'The current directors failed to lead effectively this semester.', type: 'spectrum' },
    { id: 'spec_hes_4', text: 'If people were honest, they wouldn’t re-elect some of the same directors.', type: 'spectrum' },
    { id: 'spec_hes_5', text: 'There’s at least one person in MCS I don’t really get along with.', type: 'spectrum' }
];

// ============================================================================
// GLOBAL STATE
// ============================================================================

let tracker = null;
let participantId = '';
let sessionId = '';
let phase = 'p1g'; // 'p1g' | 'p1e' | 'p2g'
let trialIndex = 0;
let startTime = null;
let dataRecords = [];
let isTransitioning = false;

// Demographics storage
let demographics = {
    age: '',
    gender: '',
    handedness: '',
    device: '',
    gesture_ui_experience: '',
    accessories: ''
};

// Video recording state
let mediaRecorder = null;
let recordedChunks = [];
let currentRecordingPhase = '';
let currentVideoFilename = '';

// Reading period state
let isReadingPeriod = false;
let readingCountdown = null;

// Timeout handling
let gestureTimeoutId = null;
const GESTURE_TIMEOUT_MS = 10000;

// ============================================================================
// PHASE HELPERS
// ============================================================================

function currentItems() {
    if (phase === 'p1g') return P1G_ITEMS;
    if (phase === 'p1e') return P1E_ITEMS;
    if (phase === 'p2g') return P2G_ITEMS;
    return [];
}

function setPanelVisible(idToShow) {
    ['panel-p1g', 'panel-p1e', 'panel-p2g'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = (id === idToShow) ? 'block' : 'none';
    });
}

// ============================================================================
// SETUP & CONSENT FLOW
// ============================================================================

function showPhase(phaseId) {
    document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
    document.getElementById(`phase-${phaseId}`)?.classList.add('active');
    
    if (phaseId !== 'setup') {
        document.getElementById('restart-btn')?.classList.remove('hidden');
    }
}

export function startConsent() {
    const pidInput = document.getElementById('participant-id');
    participantId = pidInput.value.trim();

    if (!participantId) {
        alert('Please enter a Participant ID before continuing.');
        return;
    }

    // Capture demographics
    demographics.age = document.getElementById('demo-age').value.trim();
    demographics.gender = document.getElementById('demo-gender').value;
    demographics.handedness = document.getElementById('demo-handedness').value;
    demographics.device = document.getElementById('demo-device').value;
    demographics.gesture_ui_experience = document.getElementById('demo-experience').value;
    demographics.accessories = document.getElementById('demo-accessories').value;

    if (!demographics.age || !demographics.gender || !demographics.handedness || 
        !demographics.device || !demographics.gesture_ui_experience || !demographics.accessories) {
        alert('Please complete all demographic fields before continuing.');
        return;
    }

    sessionId = `S${Date.now()}`;
    document.getElementById('session-id').value = sessionId;

    console.log('✅ Demographics captured:', demographics);
    showPhase('consent');
}

export function startInstructions() {
    const consentChecked = document.getElementById('consent-agree').checked;
    if (!consentChecked) {
        alert('Please check the consent box to continue.');
        return;
    }
    showPhase('instructions');
}

// ============================================================================
// START STUDY - Initialize P1-G
// ============================================================================

export async function startUnconstrainedPhase() {
    phase = 'p1g';
    trialIndex = 0;
    startTime = Date.now();
    dataRecords = [];
    isTransitioning = false;

    showPhase('study-phases');
    
    const video = document.getElementById('webcam-p1g');
    const canvas = document.getElementById('output-canvas-p1g');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 } 
        });
        video.srcObject = stream;

        startVideoRecording(stream, 'p1g');

        video.onloadedmetadata = async () => {
            video.play();

            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;

            tracker = new MediaPipeTracker();
            await tracker.initialize(video, canvas);

            tracker.setGestureUpdateCallback((result) => updateStatus(result, 'p1g'));
            tracker.setGestureCommitCallback((result) => onGestureCommit(result));

            console.log('✅ P1-G phase ready');
            loadCurrentItem();
        };
    } catch (err) {
        console.error('Camera initialization failed:', err);
        alert('Could not access your camera.');
    }
}

// ============================================================================
// LOAD CURRENT ITEM (Phase-aware)
// ============================================================================

function loadCurrentItem() {
    const items = currentItems();
    const item = items[trialIndex];
    
    if (!item) {
        onPhaseComplete();
        return;
    }

    if (phase === 'p1g') {
        setPanelVisible('panel-p1g');
        startGestureCaptureFor(item, 'p1g');
    } else if (phase === 'p1e') {
        setPanelVisible('panel-p1e');
        renderP1EItem(item);
    } else if (phase === 'p2g') {
        setPanelVisible('panel-p2g');
        startGestureCaptureFor(item, 'p2g');
    }

    updateProgress();
}

// ============================================================================
// START GESTURE CAPTURE (P1-G and P2-G)
// ============================================================================

function startGestureCaptureFor(item, phaseId) {
    const suffix = phaseId === 'p1g' ? '-p1g' : '-p2g';
    
    document.getElementById(`item-text${suffix}`).textContent = item.text;
    document.getElementById(`item-meta${suffix}`).textContent = 
        `Item ${trialIndex + 1} of ${currentItems().length}`;

    // Start reading period for gesture phases
    startReadingPeriod(phaseId);
}

// ============================================================================
// RENDER P1-E ITEM (Explicit buttons only)
// ============================================================================

function renderP1EItem(item) {
    const el = document.getElementById('p1e-prompt');
    if (el) el.textContent = item.text;
    
    document.getElementById('p1e-meta').textContent = 
        `Item ${trialIndex + 1} of ${currentItems().length}`;
}

// ============================================================================
// READING PERIOD COUNTDOWN
// ============================================================================

function startReadingPeriod(phaseId) {
    isReadingPeriod = true;
    let countdown = 3;
    
    const suffix = phaseId === 'p1g' ? '-p1g' : '-p2g';
    const countdownElement = document.getElementById(`reading-countdown${suffix}`);
    const statusOverlay = document.getElementById(`status-overlay${suffix}`);
    
    if (!countdownElement) return;
    
    countdownElement.classList.add('show');
    if (statusOverlay) statusOverlay.style.opacity = '0.3';
    
    countdownElement.textContent = `Please read the question... (${countdown}s)`;
    
    readingCountdown = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            countdownElement.textContent = `Please read the question... (${countdown}s)`;
        } else {
            clearInterval(readingCountdown);
            countdownElement.textContent = 'Ready! Show your gesture now 👋';
            
            setTimeout(() => {
                countdownElement.classList.remove('show');
                if (statusOverlay) statusOverlay.style.opacity = '1';
                isReadingPeriod = false;
                console.log('✅ Reading period complete');
                
                // Start timeout timer
                const currentItem = currentItems()[trialIndex];
                gestureTimeoutId = setTimeout(() => {
                    handleGestureTimeout(currentItem);
                }, GESTURE_TIMEOUT_MS);
            }, 1000);
        }
    }, 1000);
}

// ============================================================================
// UPDATE STATUS (Real-time feedback during gestures)
// ============================================================================

function updateStatus(result, phaseId) {
    if (isReadingPeriod) return;
    
    const suffix = phaseId === 'p1g' ? '-p1g' : '-p2g';
    const gestureEl = document.getElementById(`status-gesture${suffix}`);
    const holdEl = document.getElementById(`status-hold${suffix}`);
    const confEl = document.getElementById(`status-confidence${suffix}`);
    
    if (gestureEl) gestureEl.textContent = result.gesture;
    if (holdEl) holdEl.textContent = `${result.holdMs}ms`;
    if (confEl) confEl.textContent = result.confidence.toFixed(2);
}

// ============================================================================
// GESTURE COMMIT HANDLER (P1-G and P2-G)
// ============================================================================

function onGestureCommit(result) {
    if (isReadingPeriod || isTransitioning) return;
    isTransitioning = true;

    // Clear timeout
    if (gestureTimeoutId) {
        clearTimeout(gestureTimeoutId);
        gestureTimeoutId = null;
    }

    const items = currentItems();
    const item = items[trialIndex];
    const pairId = `${participantId}_${sessionId}_${item.id}`;

    const detected = !!result?.gesture;
    
    // Extract features with defaults
    const features = result?.features || {};
    const jitter = features.jitter ?? 0;
    const amplitude = features.amplitude ?? 0;
    const stability = features.stability ?? 0;
    const repetitions = features.repetitions ?? 0;
    const features_valid = !isNaN(jitter) && !isNaN(amplitude) && !isNaN(stability) && !isNaN(repetitions);
    
    // For p1_gesture phase, record the displayed gesture (what was actually detected)
    const displayed_gesture = (phase === 'p1g' && detected) ? result.gesture : '';
    
    const row = {
        participant_id: participantId,
        session_id: sessionId,
        pair_id: pairId,
        trial_id: `trial_${trialIndex + 1}`,
        prompt_id: item.id,
        phase: (phase === 'p1g') ? 'p1_gesture' : 'p2_gesture',
        gesture_label: detected ? result.gesture : 'unknown',
        displayed_gesture: displayed_gesture,  // NEW: What gesture was actually shown/detected
        implicit_confidence: Number(result?.confidence ?? 0),
        implicit_confidence_comp: result?.implicit_confidence_comp ?? 0,
        confidence_median: result?.confidence_median ?? 0,
        confidence_iqr: result?.confidence_iqr ?? 0,
        label_consistency: result?.label_consistency ?? 0,
        hold_duration_ms: Math.round(result?.holdMs ?? 0),
        detection_status: detected ? 'detected' : 'timeout_unknown',
        structured_label: '',
        timestamp: new Date().toISOString(),
        video_filename: currentVideoFilename || '',
        landmarks_padded: !!result?.landmarks_padded,
        landmarks_missing: !!result?.landmarks_missing,
        // Expanded feature columns
        jitter: jitter,
        amplitude: amplitude,
        stability: stability,
        repetitions: repetitions,
        features_valid: features_valid,
        // Original JSON for traceability
        features: JSON.stringify({
            jitter: jitter,
            amplitude: amplitude,
            stability: stability,
            repetitions: repetitions,
            thumbTipX: features.thumbTipX ?? 0,
            thumbTipY: features.thumbTipY ?? 0,
            handCentroidX: features.handCentroidX ?? 0,
            handCentroidY: features.handCentroidY ?? 0
        }),
        age: demographics.age,
        gender: demographics.gender,
        handedness: demographics.handedness,
        device: demographics.device,
        gesture_ui_experience: demographics.gesture_ui_experience,
        accessories: demographics.accessories
    };

    dataRecords.push(row);
    appendRowToCsv(row);

    console.log(`✅ ${phase.toUpperCase()} gesture committed:`, result);

    // Show green overlay
    const overlayId = (phase === 'p1g') ? 'detected-overlay-unconstrained' : 'detected-overlay';
    showDetectedOverlay(overlayId, 900);

    setTimeout(() => {
        isTransitioning = false;
        trialIndex++;
        loadCurrentItem();
    }, 3500);
}

// ============================================================================
// HANDLE GESTURE TIMEOUT
// ============================================================================

function handleGestureTimeout(item) {
    if (isTransitioning) return;
    
    console.log('⏱️ Gesture timeout - recording as unknown');
    
    onGestureCommit({ gesture: null, confidence: 0 });
}

// ============================================================================
// PHASE TRANSITIONS
// ============================================================================

function onPhaseComplete() {
    if (phase === 'p1g') {
        // Stop P1-G camera and video
        stopVideoRecording();
        const videoP1G = document.getElementById('webcam-p1g');
        if (videoP1G?.srcObject) {
            videoP1G.srcObject.getTracks().forEach(track => track.stop());
        }
        tracker?.stopProcessing();

        alert('✅ Phase 1 Gestures Complete!\n\nNow please label the same questions using buttons.');

        // Transition to P1-E
        phase = 'p1e';
        trialIndex = 0;
        setupP1EButtons(); // Ensure buttons are wired
        loadCurrentItem();
        
    } else if (phase === 'p1e') {
        alert('✅ Phase 1 Complete!\n\nStarting Phase 2: Gesture Spectrum.');

        // Transition to P2-G
        phase = 'p2g';
        trialIndex = 0;
        startP2GPhase();
        
    } else if (phase === 'p2g') {
        // All phases complete
        stopVideoRecording();
        const videoP2G = document.getElementById('webcam-p2g');
        if (videoP2G?.srcObject) {
            videoP2G.srcObject.getTracks().forEach(track => track.stop());
        }
        tracker?.stopProcessing();
        
        completeStudy();
    }
}

// ============================================================================
// START P2-G PHASE (Spectrum gestures)
// ============================================================================

async function startP2GPhase() {
    const video = document.getElementById('webcam-p2g');
    const canvas = document.getElementById('output-canvas-p2g');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 } 
        });
        video.srcObject = stream;

        startVideoRecording(stream, 'p2g');

        video.onloadedmetadata = async () => {
            video.play();

            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;

            tracker = new MediaPipeTracker();
            await tracker.initialize(video, canvas);

            tracker.setGestureUpdateCallback((result) => updateStatus(result, 'p2g'));
            tracker.setGestureCommitCallback((result) => onGestureCommit(result));

            console.log('✅ P2-G phase ready');
            loadCurrentItem();
        };
    } catch (err) {
        console.error('Camera initialization failed:', err);
        alert('Could not access your camera.');
    }
}

// ============================================================================
// P1-E EXPLICIT BUTTON HANDLERS
// ============================================================================

function setupP1EButtons() {
    document.querySelectorAll('#panel-p1e [data-p1e]').forEach(btn => {
        // Remove existing listeners to avoid duplicates
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', () => {
            if (isTransitioning) return;
            isTransitioning = true;

            const items = currentItems();
            const item = items[trialIndex];
            const pairId = `${participantId}_${sessionId}_${item.id}`;

            const row = {
                participant_id: participantId,
                session_id: sessionId,
                pair_id: pairId,
                trial_id: `trial_${trialIndex + 1}`,
                prompt_id: item.id,
                phase: 'p1_explicit',
                gesture_label: '',
                displayed_gesture: '',  // No gesture displayed in explicit phase
                implicit_confidence: 0,
                implicit_confidence_comp: 0,
                confidence_median: 0,
                confidence_iqr: 0,
                label_consistency: 0,
                hold_duration_ms: 0,
                detection_status: 'structured_label',
                structured_label: newBtn.getAttribute('data-p1e'),
                timestamp: new Date().toISOString(),
                video_filename: '',
                landmarks_padded: false,
                landmarks_missing: false,
                jitter: 0,
                amplitude: 0,
                stability: 0,
                repetitions: 0,
                features_valid: false,
                features: '',
                age: demographics.age,
                gender: demographics.gender,
                handedness: demographics.handedness,
                device: demographics.device,
                gesture_ui_experience: demographics.gesture_ui_experience,
                accessories: demographics.accessories
            };

            dataRecords.push(row);
            appendRowToCsv(row);

            console.log('✅ P1-E label selected:', row.structured_label);

            setTimeout(() => {
                isTransitioning = false;
                trialIndex++;
                loadCurrentItem();
            }, 300);
        });
    });
}

// ============================================================================
// PROGRESS UPDATE
// ============================================================================

function updateProgress() {
    const items = currentItems();
    let suffix = '';
    
    if (phase === 'p1g') suffix = '-p1g';
    else if (phase === 'p1e') suffix = '-p1e';
    else if (phase === 'p2g') suffix = '-p2g';
    
    const fillEl = document.getElementById(`progress-fill${suffix}`);
    const textEl = document.getElementById(`progress-text${suffix}`);
    
    if (fillEl && textEl) {
        const percent = ((trialIndex / items.length) * 100).toFixed(0);
        fillEl.style.width = `${percent}%`;
        textEl.textContent = `${trialIndex} / ${items.length}`;
    }
}

// ============================================================================
// VIDEO RECORDING
// ============================================================================

function startVideoRecording(stream, phaseId) {
    try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        
        recordedChunks = [];
        currentRecordingPhase = phaseId;
        currentVideoFilename = `${participantId}_${sessionId}_${phaseId}.webm`;
        
        const options = { mimeType: 'video/webm' };
        mediaRecorder = new MediaRecorder(stream, options);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            if (recordedChunks.length > 0) {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = currentVideoFilename;
                a.click();
                URL.revokeObjectURL(url);
                console.log(`🎥 Video saved: ${currentVideoFilename}`);
            }
            recordedChunks = [];
        };
        
        mediaRecorder.start();
        console.log(`🎥 Recording started for: ${phaseId}`);
        
    } catch (error) {
        console.error('🎥 Recording failed:', error);
    }
}

function stopVideoRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        console.log('🎥 Recording stopped');
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showDetectedOverlay(overlayId, ms = 900) {
    const el = document.getElementById(overlayId);
    if (!el) return;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), ms);
}

function appendRowToCsv(row) {
    console.log('📝 CSV row added:', row);
}

// ============================================================================
// STUDY COMPLETION
// ============================================================================

function completeStudy() {
    showPhase('complete');

    const endTime = Date.now();
    const durationSec = ((endTime - startTime) / 1000).toFixed(1);

    document.getElementById('summary-participant').textContent = participantId;
    document.getElementById('summary-session').textContent = sessionId;
    document.getElementById('summary-trials').textContent = dataRecords.length;
    document.getElementById('summary-duration').textContent = `${durationSec}s`;

    console.log('🎉 Study completed. Total rows:', dataRecords.length);
}

// ============================================================================
// DATA EXPORT
// ============================================================================

export function downloadData() {
    if (!dataRecords.length) {
        alert('No data to download yet.');
        return;
    }

    const header = Object.keys(dataRecords[0]);
    const csvRows = [header.join(',')];
    
    dataRecords.forEach(row => {
        const values = header.map(key => {
            let value = row[key];
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                value = `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csvRows.push(values.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${participantId}_${sessionId}_gesture_data.csv`;
    a.click();
    URL.revokeObjectURL(url);

    console.log('✅ CSV downloaded');
}

// ============================================================================
// RESTART STUDY
// ============================================================================

export function restartStudy() {
    if (confirm('Are you sure you want to restart? All current data will be cleared.')) {
        stopVideoRecording();
        
        if (readingCountdown) clearInterval(readingCountdown);
        if (gestureTimeoutId) clearTimeout(gestureTimeoutId);
        
        tracker?.stopProcessing();
        
        ['webcam-p1g', 'webcam-p2g'].forEach(id => {
            const video = document.getElementById(id);
            if (video?.srcObject) {
                video.srcObject.getTracks().forEach(track => track.stop());
            }
        });

        // Reset all state
        participantId = '';
        sessionId = '';
        phase = 'p1g';
        trialIndex = 0;
        startTime = null;
        dataRecords = [];
        tracker = null;
        isTransitioning = false;
        isReadingPeriod = false;
        
        mediaRecorder = null;
        recordedChunks = [];
        currentRecordingPhase = '';
        currentVideoFilename = '';
        
        demographics = {
            age: '',
            gender: '',
            handedness: '',
            device: '',
            gesture_ui_experience: '',
            accessories: ''
        };

        document.getElementById('participant-id').value = '';
        document.getElementById('session-id').value = '';
        document.getElementById('consent-agree').checked = false;
        document.getElementById('demo-age').value = '';
        document.getElementById('demo-gender').value = '';
        document.getElementById('demo-handedness').value = '';
        document.getElementById('demo-device').value = '';
        document.getElementById('demo-experience').value = '';
        document.getElementById('demo-accessories').value = '';

        document.getElementById('restart-btn')?.classList.add('hidden');

        showPhase('setup');
        console.log('🔄 Study restarted');
    }
} // ← This closing brace was missing!

// ============================================================================
// SESSION INITIALIZATION
// ============================================================================

function initializeSession() {
    sessionId = `S${Date.now()}`;
    document.getElementById('session-id').value = sessionId;
}

// Initialize session on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSession);
} else {
    initializeSession();
}