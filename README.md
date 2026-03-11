<div align="center">

# ◆ Nexus-Aether

### The Local-First Intelligence Powerhouse

*Frost Glass UI · Intelligent Routing · Document Studio · Agentic Sandbox · Visual Memory*

![Version](https://img.shields.io/badge/version-1.0.0-7C5CFC?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-333?style=flat-square)
![Privacy](https://img.shields.io/badge/privacy-100%25%20Local-green?style=flat-square)

</div>

---

## What is Nexus-Aether?

**Nexus-Aether** Local-first AI desktop application with a glass UI and multi-model routing.

**Your data never leaves your machine.** Nexus is built for researchers, developers, and power users who need agentic tools without sacrificing data sovereignty.
*Note: Data stays local unless you choose a cloud model.*

<p align="center">
  <img src="https://github.com/user-attachments/assets/2502c7bc-8608-41cf-8750-53187b9536bf" width="80%">
</p>

---

## 🚀 Key Features

### 🏢 Document Studio (NotebookLM Style)
Transform static documents into interactive knowledge bases. Upload PDFs or text files to chat with your local data using high-speed RAG (Retrieval Augmented Generation). Features deep-link citations and an animated response area for clarity.

### ⚔️ Multi-Model Arena
Pit the world's best models against each other. Compare responses side-by-side with real-time tracking of latency, token count, and cost metrics to find the perfect model for your prompt.

### 🧠 Visual Memory Graph
Never lose context. Nexus builds a persistent memory store of your conversations, visualized through an interactive, draggable force-directed graph. See how your thoughts and AI responses connect over time.

### 🖥️ Live Screen Share & Analysis
Share your active windows or full screen with the AI. Whether you're debugging code or analyzing UI designs, the AI can "see" your screen and provide real-time feedback.

### 🎨 Artifacts & Spatial Canvas
Render HTML/CSS/JS code live in the sidebar. Branch conversations into an infinite spatial workspace (In Progress) to visualize complex thought processes and divergent AI completions.

### 🤖 Agentic Sandbox & Scheduled Tasks
A secure execution environment for the AI to run Python or Javascript code on your behalf. Automate your life with **Scheduled Agents** that can run background tasks (news summaries, file monitoring) at specific times using specific models.


<p align="center">
  <img src="https://github.com/user-attachments/assets/35b8616e-9c2c-4eed-b12b-c0b08c6d68a6" width="45%" />
  <img src="https://github.com/user-attachments/assets/81aa7940-8fd1-4b36-98b2-6db5b98c2d51" width="45%" />
</p>

---

## 📦 Download & Install

Nexus-Aether is distributed as a standalone desktop application for maximum performance and privacy.

1. **Download**: Grab the latest installer from the [Releases](https://github.com/Vishnu852002/nexus-aether/releases) page.
2. **Install**: Run the `Nexus-Aether Setup.exe` . Windows may display a “Windows protected your PC” warning because the application is not code-signed. Click More info → Run anyway to continue.
3. **Configure**: Add your local Ollama/LM Studio endpoint or drop in your API keys for cloud providers.

*Note: For the best experience, installing Ollama is recommended to run models locally on your GPU. Running models locally can improve privacy and reduce reliance on external APIs.*

⚠️ Platform Notice

Windows builds are currently the primary tested release.

macOS and Linux versions are automatically built through CI and may not be fully tested. Feedback and bug reports from users on these platforms are greatly appreciated. Please open a GitHub issue and include logs and system details if you encounter problems.

---

## Download Guide

When you open a release, download exactly one installer for your OS:

- Windows: `Nexus-Aether.Setup.<version>.exe`
- macOS (Apple Silicon): `Nexus-Aether-<version>-arm64.dmg`
- Linux (Debian/Ubuntu): `nexus_aether_<version>_amd64.deb`
- Linux (portable): `Nexus-Aether-<version>.AppImage`

For developers:

- `nexus-aether-core-<tag>.zip` is the OSS runtime package.

Ignore these files:

- `latest*.yml` and `*.blockmap` (auto-updater metadata)
- `Source code (zip/tar.gz)` (GitHub auto-generated snapshots)

## 🛡️ Privacy by Design

- **Zero Tracking**: Your conversations are stored in a local SQLite database, not our servers.
- **Local RAG**: Document parsing and embedding happen entirely on your hardware.
- **Offline Mode**: Use local models (Llama 3, Phi-3, Mistral) without an active internet connection.

---

## 🛠️ Developer Setup

If you wish to build from source or contribute:

```bash
# Clone the repository
git clone https://github.com/Vishnu852002/nexus-aether.git

# Install dependencies
npm install

# Run the dev environment
npm run dev

# Build the Electron executable
npm run build:app
```

---

<div align="center">

**Built for the private, agentic computing.**

</div>

