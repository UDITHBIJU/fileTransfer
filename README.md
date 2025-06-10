# WebRTC File Transfer

A peer-to-peer file transfer web application built with WebRTC and Socket.IO, enabling fast, secure, and serverless file sharing directly between devices.

🔗 **Live demo**: [https://file-transfer-sand.vercel.app](https://file-transfer-sand.vercel.app)

---

## 📄 Overview

This project allows users to transfer files of any size, including large videos, directly between browsers without a central server.  
It leverages **WebRTC** for real-time data transfer and **Socket.IO** for signaling, ensuring privacy and efficiency.

---

## ⚙️ How It Works

- **WebRTC Protocol**:  
  Files are split into 128KB chunks and sent via WebRTC data channels, optimized for mobile devices with reliable delivery through chunk acknowledgments and retries.

- **Socket.IO Signaling**:  
  Manages peer connections by exchanging ICE candidates and session descriptions to establish WebRTC channels.

- **Serverless Design**:  
  No file data is stored on a server; transfers occur directly between peers, enhancing security and speed.

- **Local Network Filtering**:  
  Only users under the same public IP and subnet (same local network) can discover each other and transfer files.

---

## ✨ Features

- Real-time file transfers with low latency  
- Handles large files efficiently, even on mobile devices  
- Robust error handling with chunk retries and dynamic window sizing  
- Browser-based, no installation required  
- Peer discovery limited to same-network users for privacy and control

---

## 🧰 Prerequisites

- Node.js (v20 or higher)  
- npm (v10 or higher)  
- Modern browser (e.g., Chrome, Firefox, Safari)

---

## 🔧 Installation & Usage

```bash
# Clone the repository
git clone https://github.com/UDITHBIJU/fileTransfer.git
cd fileTransfer

# Set up and start the backend
cd backend
npm install
npm start

# In a separate terminal, set up and start the frontend
cd ../frontend
npm install
npm run dev

