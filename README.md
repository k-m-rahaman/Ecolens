<div align="center">
    <img src="assets/images/Mascot.webp" alt="EcoLens Pro Mascot" width="130" style="margin-bottom: 15px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.06));"/>
    <h1 style="border-bottom: none; margin-bottom: 8px; font-weight: 900; font-size: 3rem; color: #58cc02; letter-spacing: -1px;">EcoLens Pro</h1>
    <p style="font-size: 1.3rem; color: #4b5563; font-weight: 700; max-width: 600px; margin-top: 0; line-height: 1.4;">
        A Decentralized Edge-AI Computer Vision Ecosystem for Localized Municipal Solid Waste Management & Behavioral Gamification
    </p>
    
    <div style="margin: 18px 0 28px 0; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap;">
        <img src="https://img.shields.io/badge/Architecture-Edge--AI-1cb0f6?style=for-the-badge&logo=cpu&logoColor=white" alt="Edge AI Badge"/>
        <img src="https://img.shields.io/badge/Model-YOLOv8--Nano-58cc02?style=for-the-badge&logo=analytics&logoColor=white" alt="YOLOv8 Badge"/>
        <img src="https://img.shields.io/badge/Inference-ONNX%20Runtime-a55eea?style=for-the-badge&logo=webassembly&logoColor=white" alt="ONNX Runtime Badge"/>
        <img src="https://img.shields.io/badge/Deployment-GitHub%20Pages-333333?style=for-the-badge&logo=github&logoColor=white" alt="Deployment Badge"/>
    </div>
</div>

---

## 📖 Executive Summary
Traditional smart recycling frameworks rely heavily on centralized cloud compute servers, introducing high API network latency, continuous data overhead overheads, and persistent privacy barriers. 

**EcoLens Pro** introduces a decentralized architectural paradigm. Engineered explicitly for student communities and smart campus deployment, it utilizes an optimized, fine-tuned **YOLOv8-Nano** deep neural network model compiled directly into an **ONNX binary**. By performing high-speed tensor calculations locally inside the web browser's viewport execution pipeline via WebAssembly, EcoLens processes complex object classification loops completely client-side with absolute zero server latency.

---

## 🛠️ Detailed Technical Architecture

### 🧠 1. Real-Time Computer Vision Pipeline
* **Dataset & Augmentation:** Fine-tuned utilizing a balanced imagery collection targeting regional municipal recycling materials (clear plastics, fiber papers, green yard organics, glass anomalies, and composite cardboard).
* **Cloud Compilation Loop:** Trained on an enterprise cloud-hosted **Tesla T4 GPU** infrastructure inside Google Colab over 30 full back-propagation neural optimization cycles (`epochs=30`).
* **Half-Precision Precision Optimization:** Exported and compiled into an optimized **ONNX (Open Neural Network Exchange)** runtime structure with FP16 half-precision quantization calibration. This compressed the heavy deep learning network into a ultra-compact **5.9 MB binary tensor matrix**.
* **Client-Side Image Preprocessing:** The application captures raw data frames from the hardware camera feed via WebRTC, binds them to an HTML5 `<canvas>`, downsamples the coordinates to a strict $640 \times 640$ grid, standardizes pixel values (dividing by `255.0`), and builds a flat **Planar CHW (Channel, Height, Width) format array `[1, 3, 640, 640]`** to push straight into the local engine memory block.

### 🕹️ 2. High-Fidelity Behavioral Gamification Engine
To foster long-term recycling compliance and sustained user engagement, EcoLens features a responsive interface heavily inspired by modern gamified educational architectures:
* **Tactile Validation Checklist:** Real-time generation of micro-quest steps based on AI class resolution, utilizing an interactive DOM verification layer that syncs with dynamic acoustic feedback nodes.
* **Persistent Cache Multi-User Sync:** Uses HTML5 LocalStorage configurations to store unique encrypted profile datasets (`ecoXP_username` & `ecoHistory_username`), maintaining cross-session persistence for multiple users on a single machine.
* **Trophy Leagues Map Engine:** Features an interactive vertical milestone campaign roadmap that calculates cumulative user XP to assign competitive tier ranks (Bronze 🥉 $\rightarrow$ Silver 🥈 $\rightarrow$ Gold 🥇 $\rightarrow$ Diamond 💎 Leagues) with matching dynamic CSS UI style overhauls.
* **Native Multilingual Dictionaries:** Built-in localized translation matrix arrays handling instant interface hot-swapping across English, Bengali, and Hindi tracking loops without reloading the viewport.

---

## 🗺️ Visual User Journey Map

<div align="center">
    <img src="design/user_journey_flow.png" alt="EcoLens 4-Screen User Flow Grid" width="100%" style="border-radius: 20px; border: 2px solid #e5e7eb; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); margin: 15px 0;"/>
    <p style="font-size: 0.95rem; color: #6b7280; font-style: italic; margin-top: 8px; font-weight: 600;">Figure 1: High-Fidelity 4-Screen State Machine Wireframe Framework (Shutter View $\rightarrow$ AI Verification $\rightarrow$ Gamified Checklist $\rightarrow$ Proof Gate Modifier Grid)</p>
</div>

---

## 📂 System Directory Structure
```text
EcoLensProjectRoot/
├── index.html                   # Core Entry Window (Unified Semantic Layout & Translation Matrix)
├── README.md                    # Project Documentation Registry
├── models/
│   └── custom-yolo/
│       └── GarbageDetector.onnx # Fine-Tuned 5.9MB Quantized Tensor Weight Binary
├── assets/
│   ├── audio/
│   │   ├── Success.mp3          # Checkpoint Validation Acoustic Node
│   │   └── Levelup.mp3          # Milestone League Elevation Audio Hook
│   └── images/
│       └── Mascot.webp          # EcoLens Main Engagement Guide Graphic
└── design/
    ├── user_journey_flow.png    # High-Fidelity 4-Screen User Journey Flowchart
    └── ui_component_library.png # Figma Modular Global UI Component Library

---

## 🚀 Installation & Local Deployment Setup
To initiate the edge-native AI runtime locally:

Clone or download this project directory workspace setup folder to your computer hardware.

Verify that your fine-tuned weights file sits precisely at: models/custom-yolo/GarbageDetector.onnx.

Open the directory workspace using VS Code, and launch the Go Live server extension on the bottom status bar (http://127.0.0.1:5500).

Input your profile name into the authentication gate modal window, approve device camera stream clearance, and press F12 to open the developer console to track the live tensor matrix execution parameters.