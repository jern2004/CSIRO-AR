import { GestureRecognizer, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

class MediaPipeTracker {
    constructor() {
        this.gestureRecognizer = null;
        this.handLandmarker = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;
        this.isProcessing = false;
        this.lastVideoTime = -1;
        
        // Gesture state tracking
        this.currentGesture = 'neutral';
        this.gestureStartTime = null;
        this.gestureHoldDuration = 0;
        this.gestureConfidence = 0;
        
        // 21-point hand landmarks
        this.currentLandmarks = [];
        this.landmarkHistory = [];
        this.maxHistoryLength = 30;
        
        // Per-frame histories for composite confidence (cap at 30)
        this.scoreHistory = [];
        this.labelHistory = [];
        
        // Callbacks
        this.onGestureCommit = null;
        this.onGestureUpdate = null;
        
        // Thresholds
        this.HOLD_THRESHOLD_MS = 900;
        this.MIN_CONFIDENCE = 0.65;
        
        // OK gesture detection threshold
        this.OK_GESTURE_DISTANCE_THRESHOLD = 0.05;
    }

    // INITIALIZATION

    async initialize(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasCtx = canvasElement.getContext('2d');

        try {
            console.log('Initializing MediaPipe (local)...');
            
            const visionFiles = await FilesetResolver.forVisionTasks(
                '/node_modules/@mediapipe/tasks-vision/wasm'
            );
            
            // Initialize Gesture Recognizer
            this.gestureRecognizer = await GestureRecognizer.createFromOptions(
                visionFiles,
                {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
                        delegate: 'GPU'
                    },
                    numHands: 1,
                    runningMode: 'VIDEO',
                    minHandDetectionConfidence: 0.5,
                    minHandPresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5
                }
            );

            // Initialize Hand Landmarker (for 21 points)
            this.handLandmarker = await HandLandmarker.createFromOptions(
                visionFiles,
                {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                        delegate: 'GPU'
                    },
                    numHands: 1,
                    runningMode: 'VIDEO',
                    minHandDetectionConfidence: 0.5,
                    minHandPresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5
                }
            );

            console.log('✅ MediaPipe initialized successfully (Gesture + HandLandmarks)');
            this.startProcessing();
            
        } catch (error) {
            console.error('❌ MediaPipe initialization failed:', error);
            throw error;
        }
    }

    // PROCESSING LOOP

    startProcessing() {
        this.isProcessing = true;
        this.processFrame();
    }

    stopProcessing() {
        this.isProcessing = false;
    }

    async processFrame() {
        if (!this.isProcessing || !this.gestureRecognizer || !this.handLandmarker) return;

        const video = this.videoElement;
        
        if (video.currentTime !== this.lastVideoTime) {
            this.lastVideoTime = video.currentTime;
            
            try {
                const nowMs = performance.now();
                
                // Get both gesture recognition AND hand landmarks
                const gestureResults = this.gestureRecognizer.recognizeForVideo(video, nowMs);
                const landmarkResults = this.handLandmarker.detectForVideo(video, nowMs);
                
                this.handleResults(gestureResults, landmarkResults, nowMs);
                
            } catch (error) {
                console.error('Frame processing error:', error);
            }
        }

        requestAnimationFrame(() => this.processFrame());
    }

    // RESULTS HANDLING (with OK gesture and unknown gesture support)

    handleResults(gestureResults, landmarkResults, timestamp) {
        this.clearCanvas();

        // Draw video frame
        this.canvasCtx.save();
        this.canvasCtx.drawImage(
            this.videoElement,
            0, 0,
            this.canvasElement.width,
            this.canvasElement.height
        );
        this.canvasCtx.restore();

        // Extract 21-point landmarks
        const handDetected = landmarkResults.landmarks && landmarkResults.landmarks.length > 0;
        
        if (handDetected) {
            // Validate and ensure 21 landmarks
            const rawLandmarks = landmarkResults.landmarks[0];
            this.currentLandmarks = this.ensure21Landmarks(rawLandmarks);
            
            // Draw hand skeleton (21 points)
            this.drawLandmarks(this.currentLandmarks);
            this.drawConnections(this.currentLandmarks);
            
            // Store for feature extraction
            this.storeLandmarkHistory(this.currentLandmarks, timestamp);
        } else {
            this.currentLandmarks = [];
            this.resetGesture();
            return;
        }

        // Check for OK gesture first (overrides MediaPipe detection)
        const isOkGesture = this.detectOkGesture(this.currentLandmarks);
        
        if (isOkGesture) {
            const okGesture = {
                categoryName: 'OK_Sign',
                score: 0.85
            };
            this.trackGesture(okGesture, timestamp);
        }
        else if (gestureResults.gestures && gestureResults.gestures.length > 0) {
            const gesture = gestureResults.gestures[0][0];
            this.trackGesture(gesture, timestamp);
        } else if (handDetected) {
            // Hand detected but no recognized gesture - treat as "unknown"
            const unknownGesture = {
                categoryName: 'Unknown',
                score: 0.5
            };
            this.trackGesture(unknownGesture, timestamp);
        } else {
            this.resetGesture();
        }
    }

    // GESTURE TRACKING (with unknown gesture handling)

    trackGesture(gesture, timestamp) {
        if (!gesture) {
            this.resetGesture();
            return;
        }

        const gestureName = this.normalizeGestureName(gesture.categoryName);
        const confidence = gesture.score;

        // For unknown gestures with hand detected, use lower confidence threshold
        const minConfidence = gestureName === 'unknown' ? 0.3 : this.MIN_CONFIDENCE;

        if (confidence < minConfidence) {
            this.resetGesture();
            return;
        }

        if (gestureName !== this.currentGesture) {
            this.currentGesture = gestureName;
            this.gestureStartTime = timestamp;
            this.gestureHoldDuration = 0;
        } else {
            this.gestureHoldDuration = timestamp - this.gestureStartTime;
        }

        this.gestureConfidence = confidence;

        // Track per-frame score and label for composite confidence
        this.scoreHistory.push(confidence);
        this.labelHistory.push(gestureName);
        
        // Cap histories at 30 frames
        if (this.scoreHistory.length > 30) this.scoreHistory.shift();
        if (this.labelHistory.length > 30) this.labelHistory.shift();

        if (this.onGestureUpdate) {
            this.onGestureUpdate({
                gesture: this.currentGesture,
                holdMs: Math.round(this.gestureHoldDuration),
                confidence: this.gestureConfidence,
                landmarks: this.currentLandmarks
            });
        }

        if (this.gestureHoldDuration >= this.HOLD_THRESHOLD_MS && 
            this.currentGesture !== 'neutral') {
            this.commitGesture();
        }
    }

    normalizeGestureName(categoryName) {
        const mapping = {
            'Thumb_Up': 'up',
            'Thumbs_Up': 'up',
            'Thumb_Down': 'down',
            'Thumbs_Down': 'down',
            'Closed_Fist': 'fist',
            'Open_Palm': 'palm',
            'Pointing_Up': 'pointing',
            'Victory': 'victory',
            'ILoveYou': 'iloveyou',
            'OK_Sign': 'ok',
            'None': 'neutral'
        };
        
        if (mapping[categoryName]) {
            return mapping[categoryName];
        }
        
        if (categoryName && categoryName !== 'None') {
            return 'unknown';
        }
        
        return 'neutral';
    }

    resetGesture() {
        const wasTracking = this.currentGesture !== 'neutral';
        
        this.currentGesture = 'neutral';
        this.gestureStartTime = null;
        this.gestureHoldDuration = 0;
        this.gestureConfidence = 0;
        
        // Clear per-frame histories
        this.scoreHistory = [];
        this.labelHistory = [];

        if (wasTracking && this.onGestureUpdate) {
            this.onGestureUpdate({
                gesture: 'neutral',
                holdMs: 0,
                confidence: 0,
                landmarks: []
            });
        }
    }

    commitGesture() {
        const features = this.extractFeatures();
        const compositeMetrics = this.calculateCompositeConfidence();
        
        if (this.onGestureCommit) {
            this.onGestureCommit({
                gesture: this.currentGesture,
                holdMs: Math.round(this.gestureHoldDuration),
                confidence: this.gestureConfidence,
                features: features,
                landmarks: this.currentLandmarks,
                landmarks_padded: this.landmarksPadded || false,
                landmarks_missing: this.landmarksMissing || false,
                ...compositeMetrics
            });
        }

        this.resetGesture();
        this.landmarkHistory = [];
    }

    // FEATURE EXTRACTION (from 21 points)

    storeLandmarkHistory(landmarks, timestamp) {
        this.landmarkHistory.push({
            landmarks: landmarks,
            timestamp: timestamp
        });

        while (this.landmarkHistory.length > this.maxHistoryLength) {
            this.landmarkHistory.shift();
        }
    }

    // OK gesture detection using landmark heuristic
    detectOkGesture(landmarks) {
        if (!landmarks || landmarks.length < 21) {
            return false;
        }

        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const ringTip = landmarks[16];
        const pinkyTip = landmarks[20];
        
        const thumbMcp = landmarks[2];
        const indexMcp = landmarks[5];
        const middleMcp = landmarks[9];
        const ringMcp = landmarks[13];
        const pinkyMcp = landmarks[17];

        // Calculate distance between thumb tip and index tip
        const thumbIndexDistance = Math.hypot(
            thumbTip.x - indexTip.x,
            thumbTip.y - indexTip.y,
            thumbTip.z - indexTip.z
        );

        const areTouching = thumbIndexDistance < this.OK_GESTURE_DISTANCE_THRESHOLD;

        if (!areTouching) {
            return false;
        }

        const isMiddleExtended = middleTip.y < middleMcp.y - 0.05;
        const isRingExtended = ringTip.y < ringMcp.y - 0.05;
        const isPinkyExtended = pinkyTip.y < pinkyMcp.y - 0.05;

        return areTouching && isMiddleExtended && isRingExtended && isPinkyExtended;
    }

    extractFeatures() {
        if (this.landmarkHistory.length < 2) {
            return {
                amplitude: 0,
                jitter: 0,
                stability: 0,
                repetitions: 0,
                thumbTipX: 0,
                thumbTipY: 0,
                handCentroidX: 0,
                handCentroidY: 0
            };
        }

        const amplitude = this.calculateAmplitude();
        const jitter = this.calculateJitter();
        const stability = Math.max(0, 1 - jitter);
        const repetitions = this.countRepetitions();
        
        const thumbTip = this.currentLandmarks[4];
        
        let centroidX = 0, centroidY = 0;
        for (const landmark of this.currentLandmarks) {
            centroidX += landmark.x;
            centroidY += landmark.y;
        }
        centroidX /= this.currentLandmarks.length;
        centroidY /= this.currentLandmarks.length;

        return {
            amplitude: parseFloat(amplitude.toFixed(4)),
            jitter: parseFloat(jitter.toFixed(4)),
            stability: parseFloat(stability.toFixed(4)),
            repetitions: repetitions,
            thumbTipX: parseFloat(thumbTip.x.toFixed(4)),
            thumbTipY: parseFloat(thumbTip.y.toFixed(4)),
            handCentroidX: parseFloat(centroidX.toFixed(4)),
            handCentroidY: parseFloat(centroidY.toFixed(4))
        };
    }

    calculateAmplitude() {
        const thumbPositions = this.landmarkHistory.map(h => h.landmarks[4]);
        
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        
        for (const pos of thumbPositions) {
            minX = Math.min(minX, pos.x);
            maxX = Math.max(maxX, pos.x);
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y);
        }

        const rangeX = maxX - minX;
        const rangeY = maxY - minY;
        
        return Math.sqrt(rangeX * rangeX + rangeY * rangeY);
    }

    calculateJitter() {
        if (this.landmarkHistory.length < 3) return 0;

        const thumbPositions = this.landmarkHistory.map(h => h.landmarks[4]);
        const movements = [];

        for (let i = 1; i < thumbPositions.length; i++) {
            const dx = thumbPositions[i].x - thumbPositions[i-1].x;
            const dy = thumbPositions[i].y - thumbPositions[i-1].y;
            movements.push(Math.sqrt(dx * dx + dy * dy));
        }

        const meanMovement = movements.reduce((a, b) => a + b, 0) / movements.length;
        const variance = movements.reduce((sum, m) => sum + Math.pow(m - meanMovement, 2), 0) / movements.length;
        
        return Math.sqrt(variance);
    }

    countRepetitions() {
        if (this.landmarkHistory.length < 3) return 0;

        const thumbYPositions = this.landmarkHistory.map(h => h.landmarks[4].y);
        let repetitions = 0;
        let previousDirection = 0;

        for (let i = 1; i < thumbYPositions.length; i++) {
            const delta = thumbYPositions[i] - thumbYPositions[i-1];
            
            if (Math.abs(delta) > 0.02) {
                const currentDirection = Math.sign(delta);
                
                if (currentDirection !== 0 && previousDirection !== 0 && 
                    currentDirection !== previousDirection) {
                    repetitions++;
                }
                
                if (currentDirection !== 0) {
                    previousDirection = currentDirection;
                }
            }
        }

        return repetitions;
    }

    // ============================================================================
    // 21-LANDMARK VALIDATION & COMPOSITE CONFIDENCE
    // ============================================================================

    ensure21Landmarks(rawLandmarks) {
        this.landmarksPadded = false;
        this.landmarksMissing = false;

        if (!rawLandmarks || rawLandmarks.length === 0) {
            // No landmarks - create 21 nulls
            this.landmarksMissing = true;
            return Array(21).fill({ x: 0, y: 0, z: 0 });
        }

        if (rawLandmarks.length === 21) {
            // Perfect - return as-is
            return rawLandmarks;
        }

        if (rawLandmarks.length < 21) {
            // Pad to 21 with last valid point
            this.landmarksPadded = true;
            const padded = [...rawLandmarks];
            const lastPoint = rawLandmarks[rawLandmarks.length - 1];
            while (padded.length < 21) {
                padded.push({ ...lastPoint });
            }
            return padded;
        }

        // More than 21 - truncate (shouldn't happen)
        return rawLandmarks.slice(0, 21);
    }

    calculateCompositeConfidence() {
        if (this.scoreHistory.length === 0) {
            // Return zeros instead of null when no history
            return {
                implicit_confidence_comp: 0,
                confidence_median: 0,
                confidence_iqr: 0,
                label_consistency: 0
            };
        }

        // Calculate median
        const sortedScores = [...this.scoreHistory].sort((a, b) => a - b);
        const mid = Math.floor(sortedScores.length / 2);
        const score_median = sortedScores.length % 2 === 0
            ? (sortedScores[mid - 1] + sortedScores[mid]) / 2
            : sortedScores[mid];

        // Calculate IQR
        const q1Idx = Math.floor(sortedScores.length * 0.25);
        const q3Idx = Math.floor(sortedScores.length * 0.75);
        const score_iqr = sortedScores[q3Idx] - sortedScores[q1Idx];

        // Label consistency
        const committedLabel = this.currentGesture;
        const matchingLabels = this.labelHistory.filter(l => l === committedLabel).length;
        const label_consistency = matchingLabels / this.labelHistory.length;

        // Jitter normalized (from feature extraction)
        const features = this.extractFeatures();
        const jitter_norm = Math.min(1, features.jitter / 0.05);

        // Composite formula: EXACTLY as specified
        const implicit_confidence_comp = Math.max(0, Math.min(1,
            0.60 * score_median +
            0.25 * label_consistency +
            0.15 * (1 - jitter_norm)
        ));

        return {
            implicit_confidence_comp: this.round4(implicit_confidence_comp),
            confidence_median: this.round4(score_median),
            confidence_iqr: this.round4(score_iqr),
            label_consistency: this.round4(label_consistency)
        };
    }

    round4(x) {
        return (x == null) ? null : +Number(x).toFixed(4);
    }

    // DRAWING FUNCTIONS

    clearCanvas() {
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }

    drawLandmarks(landmarks) {
        const width = this.canvasElement.width;
        const height = this.canvasElement.height;

        this.canvasCtx.fillStyle = '#00FF00';
        this.canvasCtx.lineWidth = 2;

        for (const landmark of landmarks) {
            const x = landmark.x * width;
            const y = landmark.y * height;

            this.canvasCtx.beginPath();
            this.canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
            this.canvasCtx.fill();
        }
    }

    drawConnections(landmarks) {
        const width = this.canvasElement.width;
        const height = this.canvasElement.height;

        const connections = [
            [0,1],[1,2],[2,3],[3,4],
            [0,5],[5,6],[6,7],[7,8],
            [5,9],[9,10],[10,11],[11,12],
            [9,13],[13,14],[14,15],[15,16],
            [13,17],[17,18],[18,19],[19,20],
            [0,17]
        ];

        this.canvasCtx.strokeStyle = '#00FF00';
        this.canvasCtx.lineWidth = 2;

        for (const [start, end] of connections) {
            if (landmarks[start] && landmarks[end]) {
                const x1 = landmarks[start].x * width;
                const y1 = landmarks[start].y * height;
                const x2 = landmarks[end].x * width;
                const y2 = landmarks[end].y * height;

                this.canvasCtx.beginPath();
                this.canvasCtx.moveTo(x1, y1);
                this.canvasCtx.lineTo(x2, y2);
                this.canvasCtx.stroke();
            }
        }
    }

    // PUBLIC METHODS

    setGestureCommitCallback(callback) {
        this.onGestureCommit = callback;
    }

    setGestureUpdateCallback(callback) {
        this.onGestureUpdate = callback;
    }

    destroy() {
        this.stopProcessing();
        if (this.gestureRecognizer) this.gestureRecognizer.close();
        if (this.handLandmarker) this.handLandmarker.close();
    }
}

export default MediaPipeTracker;