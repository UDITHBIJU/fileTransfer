import express, { Request, Response } from "express";
import { Server } from "socket.io";
import cors from "cors";
import http from "http";
import { initializeSocketEvents } from "./controllers/peerController";
import { setupRoutes } from "./routes/api";
import { Peers } from "./types/peer"; 

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());


const peers : Peers = {};
// Initialize socket events
initializeSocketEvents(io);
// Setup API routes
app.use("/api", setupRoutes(peers));

server.listen(4001, "0.0.0.0", () => {
	console.log("Server is running on port 4001");
});
