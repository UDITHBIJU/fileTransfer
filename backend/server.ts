
import express, { Request, Response } from "express";
import { Server } from "socket.io";
import cors from "cors";
import http from "http";
import https from "https";
import fs from "fs";
import { initializeSocketEvents } from "./controllers/peerController";
import { setupRoutes } from "./routes/api";
import { Peers } from "./types/peer";

const app = express();

const isProduction = process.env.NODE_ENV === "production";
let server;

if (isProduction) {
  const privateKey = fs.readFileSync("/path/to/privkey.pem", "utf8");
  const certificate = fs.readFileSync("/path/to/cert.pem", "utf8");
  const credentials = { key: privateKey, cert: certificate };
  server = https.createServer(credentials, app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: isProduction ? "https://yourapp.com" : "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors({
  origin: isProduction ? "https://yourapp.com" : "*",
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const peers: Peers = {};
initializeSocketEvents(io);
app.use("/api", setupRoutes(peers));

const port = parseInt(process.env.PORT || "4001", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
});
