import express, { Request, Response } from "express";
import { Server } from "socket.io";
import cors from "cors";
import http from "http";

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

// Store peers with their public IPs
// const peers :{[socketId: string]: {publicIP:string}} = {};
const peers: { [socketId: string]: string } = {};

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());


app.get("/", async (req: Request, res: Response) => {
	console.log("test");
    res.status(200).json({ message: "Server is running" });
});

//socket.io connection listening for client which have socket.io 
io.on("connection", (socket) => {
    const publicIp = socket.handshake.headers['x-forwarded-for'] || socket.request.connection.remoteAddress || "unknown";
    // peers[socket.id] = { publicIP: publicIp as string };
      peers[socket.id] = publicIp.toString();
    console.log(`New connection: ${socket.id} from ${publicIp}`);
    console.log("Current peers:", peers);

    socket.on("disconnect", () => {
        console.log(`Peer disconnected: ${socket.id}`);
        delete peers[socket.id];
        console.log("Current peers after disconnect:", peers);
    });
})
app.listen(4001, () => {
	console.log("Server is running on port 4001");
});
