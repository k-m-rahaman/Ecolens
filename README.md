````markdown
<div align="center">

<img src="assets/images/Mascot.webp" alt="EcoLens Pro Mascot" width="140"/>

# EcoLens Pro 🌱♻️

### AI-Powered Smart Waste Management System

#### A Gamified Edge-AI Computer Vision Platform for Sustainable Recycling

<br/>

<img src="https://img.shields.io/badge/AI-YOLOv8_Nano-58cc02?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Runtime-ONNX_Runtime-a55eea?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Deployment-GitHub_Pages-333333?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Frontend-HTML_CSS_JS-1cb0f6?style=for-the-badge"/>
<img src="https://img.shields.io/badge/Status-Active-success?style=for-the-badge"/>

<br/><br/>

> Transforming waste management using Edge AI, Computer Vision, and Gamified User Experience.

</div>

---

# 📖 Overview

Traditional recycling systems often rely on cloud servers for image processing, causing:

- High latency  
- Privacy concerns  
- Expensive infrastructure  
- Internet dependency  

**EcoLens Pro** solves this by running an optimized AI model directly inside the browser using **ONNX Runtime** and **YOLOv8 Nano**.

The platform detects recyclable materials in real time using the user's camera and rewards sustainable behavior through gamification systems inspired by modern learning apps.

---

# 🚀 Features

## 🧠 AI-Powered Waste Detection
- Real-time garbage classification
- Browser-based inference
- No external API calls
- Optimized YOLOv8 Nano model
- ONNX Runtime acceleration

## ⚡ Edge AI Architecture
- Fully client-side execution
- Low latency inference
- Privacy-first design
- Works without cloud processing

## 🎮 Gamified Experience
- XP progression system
- Trophy leagues
- Achievement tracking
- Daily eco challenges
- Interactive task validation

## 🌍 Multilingual Support
Supports:
- English
- Bengali
- Hindi

## 💾 Persistent Profiles
- LocalStorage-based profile system
- Saves XP, league progress, and achievements
- Session persistence across browser restarts

---

# 🏗️ Technical Architecture

## 1️⃣ Model Training Pipeline

| Component | Details |
|---|---|
| Model | YOLOv8 Nano |
| Training Platform | Google Colab |
| GPU | Tesla T4 |
| Epochs | 30 |
| Export Format | ONNX |
| Optimization | FP16 Quantization |
| Final Model Size | 5.9 MB |

---

## 2️⃣ Edge Inference Workflow

```text
Camera Feed
     ↓
Frame Capture
     ↓
640×640 Resize
     ↓
Pixel Normalization
     ↓
Tensor Conversion
[1,3,640,640]
     ↓
ONNX Runtime
     ↓
Object Detection
     ↓
Gamified Feedback
````

---

# 🖼️ User Journey

<div align="center">

<img src="design/user_journey_flow.png" width="100%" alt="EcoLens User Flow"/>

### Camera → Detection → Validation → Rewards

</div>

---

# 📂 Project Structure

```text
EcoLens-Pro/
│
├── index.html
├── README.md
│
├── models/
│   └── custom-yolo/
│       └── GarbageDetector.onnx
│
├── assets/
│   ├── audio/
│   │   ├── Success.mp3
│   │   └── Levelup.mp3
│   │
│   └── images/
│       └── Mascot.webp
│
└── design/
    ├── user_journey_flow.png
    └── ui_component_library.png
```

---

# 🛠️ Installation

## 1️⃣ Clone Repository

```bash
git clone https://github.com/your-username/EcoLens-Pro.git
```

---

## 2️⃣ Open Project

Open the folder using:

* VS Code
* Cursor
* Windsurf
* Any Live Server compatible editor

---

## 3️⃣ Add Model File

Place the ONNX model inside:

```text
models/custom-yolo/GarbageDetector.onnx
```

---

## 4️⃣ Start Live Server

In VS Code:

* Install **Live Server Extension**
* Right click `index.html`
* Click **Open with Live Server**

---

## 5️⃣ Run Application

* Allow camera permissions
* Enter username
* Start scanning waste objects
* Earn XP and unlock leagues

---

# 🧪 Tech Stack

| Layer      | Technology            |
| ---------- | --------------------- |
| Frontend   | HTML, CSS, JavaScript |
| AI Model   | YOLOv8 Nano           |
| Runtime    | ONNX Runtime Web      |
| Training   | Google Colab          |
| Storage    | LocalStorage          |
| Deployment | GitHub Pages          |

---

# 🌱 Sustainability Impact

EcoLens encourages environmentally responsible behavior by making recycling:

* Interactive
* Educational
* Rewarding
* Accessible

The platform is designed for:

* Schools
* Colleges
* Municipal awareness campaigns
* Community recycling drives

---

# 👥 Team

## 👨‍💻 Kazi Mustafijur Rahaman

### Project Lead • AI Engineering • Full Stack Development

* Built the complete Edge-AI pipeline
* Trained and optimized YOLOv8 model
* Developed ONNX inference workflow
* Implemented multilingual engine
* Created gamification architecture
* Engineered persistence systems

---

## 🎨 Anisha

### UI/UX Designer

* Designed gamified interface system
* Created Figma wireframes
* Developed user journey layouts

---

## 📊 Koyel

### System Architecture & Flow Design

* Designed technical workflow diagrams
* Visualized inference and state pipelines

---

# 📸 Future Improvements

* Mobile app version
* Offline PWA support
* Leaderboard backend
* Smart municipal analytics
* Geo-tagged recycling heatmaps
* AI recycling education assistant

---

# ⭐ Why EcoLens Pro Matters

EcoLens Pro demonstrates how modern AI can be:

* Lightweight
* Accessible
* Privacy-friendly
* Sustainable
* Community-driven

By combining Edge AI with gamification, the project transforms recycling into an engaging real-world experience.

---

<div align="center">

# 🌍 Build Smart. Recycle Better.

Made with ❤️ using AI for sustainability.

</div>
```
