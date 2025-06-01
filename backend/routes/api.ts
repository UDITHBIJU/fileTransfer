import {Router} from 'express';
import { getRoot,getPeers } from '../controllers/peerController';
import { Peers } from '../types/peer';

export function setupRoutes(peers: Peers): Router {
    const router = Router();

    // Root endpoint
    router.get('/', getRoot);

    // Endpoint to get all peers
    router.get('/peers', (req, res) => getPeers(peers, req, res));

    return router;
}
