# CSIRO-AR Gesture Confidence Study Prototype

## 🧠 Overview
This repository contains the research prototype developed as part of the **CSIRO Internship** project on *Gesture-Based Confidence Analysis*.  
The study investigates how **implicit confidence**, inferred from **hand gesture dynamics**, compares with **explicit self-reported confidence** in a web-based interaction environment.

The system records participant gestures, computes implicit confidence metrics based on their motion stability and consistency, and collects explicit confidence ratings.  
This project demonstrates a real-time browser-based data collection tool for research on **human affect, confidence, and decision-making**.

---

## 🎯 Research Objective
The goal of this study is to determine whether **gesture behaviour** (smoothness, steadiness, duration) can reveal **implicit confidence** during responses to emotionally or socially loaded questions.

Specifically, it aims to:
- Capture natural, spontaneous hand gestures in response to prompts.
- Quantify gesture-level implicit confidence using motion features.
- Compare those implicit indicators with explicit (button-based) confidence responses.
- Analyze how hesitation and certainty manifest through motion characteristics.

---

## 🧩 System Features

### 🧱 Study Phases
The study consists of **three structured phases**:

1. **Phase 1 — Gestures (P1-G)**  
   Participants respond to general questions with any natural gesture (thumbs up/down, wave, peace sign, etc.).  
   Implicit confidence metrics are automatically computed.

2. **Phase 1 — Explicit Labels (P1-E)**  
   Participants label the same questions using structured options:  
   `Very good`, `Good`, `Neutral`, `Bad`, `Very bad`.

3. **Phase 2 — Gesture Spectrum (P2-G)**  
   Participants perform gestures across a social/emotional spectrum, from “really chill” to “very hesitant,” in response to MCS-related declarative statements.

---

### 🖐️ Real-Time Hand Tracking
- Uses **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`)  
  Components:  
  - `GestureRecognizer` — detects discrete gestures  
  - `HandLandmarker` — captures 21-point hand landmarks

- **Visual Feedback:**  
  Live overlay showing detected gesture, hold duration, and confidence.

- **Landmark Features Extracted:**
  - Gesture hold time (ms)
  - Amplitude of motion
  - Jitter (movement variance)
  - Stability
  - Repetitions (gesture oscillations)

---

## 🧮 Implicit Confidence Computation

Each gesture produces frame-wise detection scores.  
The system maintains short-term histories of gesture confidence and label consistency to compute **composite implicit confidence**:
implicit_confidence_comp =
0.60 * score_median +
0.25 * label_consistency +
0.15 * (1 - jitter_norm)

implicit_confidence_comp =
0.60 * score_median +
0.25 * label_consistency +
0.15 * (1 - jitter_norm)

## 🧪 Running the Study

1. Open the study web interface.
2. Enter participant ID and demographics.
3. Read the consent statement and agree to continue.
4. Proceed through:
   - **Phase 1-G:** perform natural gestures.
   - **Phase 1-E:** provide explicit labels.
   - **Phase 2-G:** perform gestures from chill → hesitant spectrum.
5. When complete, click **📥 “Download Data (CSV)”**.

> All data are stored client-side and no server upload occurs.

---

## 🧱 System Architecture
CSIRO-AR/
│
├── index.html # Main user interface
├── app.js # Phase flow, data handling, and video management
├── mediapipe-tracker.js # Hand tracking and implicit confidence computation
├── style.css # Full UI design and overlay styling
├── config.json # Confidence and threshold configuration
└── /node_modules # MediaPipe runtime dependencies

---

## 📈 Suggested Analysis Directions

### 1️⃣ Implicit vs Explicit Confidence Correlation
Pair trials by `pair_id` and compute correlations between:
- `implicit_confidence_comp`
- Mapped explicit values (`Very good` → 5 … `Very bad` → 1)

### 2️⃣ Gesture Smoothness and Stability
Plot `stability` vs `implicit_confidence_comp` to identify whether smoother gestures correspond to higher confidence.

### 3️⃣ Gesture Type Comparisons
Analyze average confidence for different gesture types (`up`, `down`, `unknown`) across phases.

### 4️⃣ Social Pressure Effects
Compare Phase 1 vs Phase 2 responses — “brutal” or socially sensitive statements tend to produce more hesitation and lower implicit confidence.

---

## 🧍‍♀️ Example Spectrum Prompts (Phase 2)

| Spectrum       | Example Statement                                             |
|----------------|----------------------------------------------------------------|
| **Chill**      | “MCS event was fun this semester.”                            |
| **Neutral**    | “The committee worked well together this year.”               |
| **Hesitant**   | “Some directors were chosen because of popularity, not effort.” |
| **Very Hesitant** | “There’s someone in MCS I genuinely dislike.”             |
| **Super Hesitant** | “We’d be better off if some leaders stepped down tonight.” |

*Each prompt elicits gestures varying in emotional confidence and hesitation, ideal for implicit confidence analysis.*

---

## 🧩 Technologies Used

| Category         | Technology                  |
|------------------|-----------------------------|
| Front-end        | HTML5, CSS3, Vanilla JavaScript |
| Gesture Tracking | MediaPipe Tasks Vision      |
| Video Recording  | MediaRecorder API           |
| Data Export      | CSV (Blob-based download)   |
| Visualization    | Canvas overlay rendering    |

---

## 🧠 Key Technical Highlights

- Dynamic hand landmark validation (pads to 21 points if missing)
- Custom **OK sign** detection heuristic
- Automatic gesture timeout for non-responses
- Per-frame score smoothing for stability
- JSON-encoded motion features stored for reproducibility

---

## 🔒 Data Privacy & Ethics

- All webcam processing occurs **locally in-browser**.
- No video or landmark data is uploaded externally.
- Only anonymized CSV files are saved by participants.

---

## 📚 Example Research Workflow

1. Collect CSVs from multiple participants.
2. Merge into a master dataset.
3. Clean and normalize implicit metrics.
4. Perform statistical analysis (e.g., correlation, Mann–Whitney U test).
5. Visualize gesture-based confidence distributions.

---

## 🪪 License

This project is intended for **academic and research purposes only** under supervision by CSIRO and The University of Western Australia.  
Redistribution or commercial use is not permitted without written consent.
