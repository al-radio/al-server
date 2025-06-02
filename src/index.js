import express from "express";
import cors from "cors";
import songRoutes from "./routes/routes.js";
import SpotifyService from "./services/SpotifyService.js";
import ProxyService from "./services/ProxyService.js";
import QueueService from "./services/QueueService.js";
import SongController from "./controllers/SongController.js";
import DatabaseService from "./services/db/DatabaseService.js";
import RequestModelService from "./services/db/RequestModelService.js";
import AccountModelService from "./services/db/AccountModelService.js";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import ClientManager from "./client/ClientManager.js";
import { runWithContext, getContext } from "./utils/asyncLocalStorage.js";
import { generateTaskId, log, logFullContext } from "./utils/logger.js";
import EventService from "./services/EventService.js";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const audioDir = path.join(__dirname, "..", "audio");
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}
fs.readdir(audioDir, (err, files) => {
  if (err) throw err;
  for (const file of files) {
    fs.unlink(path.join(audioDir, file), (err) => {
      if (err) throw err;
    });
  }
});

if (process.env.APPLE_COOKIES) {
  fs.writeFileSync("./cookies.txt", process.env.APPLE_COOKIES);
}

const corsOptions = {
  origin: process.env.CLIENT_URL || "*",
  optionsSuccessStatus: 200,
  credentials: true,
};

const app = express();
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

app.use((req, res, next) => {
  const taskId = generateTaskId();
  const requestMethod = req.method;
  const requestUrl = req.url;
  req.taskId = taskId;
  runWithContext(
    {
      taskType: "client-task",
      taskId,
      category: "REQUEST",
      requestMethod,
      requestUrl,
    },
    () => {
      if (requestUrl !== "/status") logFullContext("info", "");
      try {
        next();
      } catch (err) {
        log("error", `Error: ${err.stack}`);
        res.status(500).send("Something went wrong.");
      }
    },
  );
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log("error", `SERVER ERROR: ${err.stack}`, {
    taskId: getContext().taskId,
  });
  res.status(500).send("Something went wrong.");
});
app.use("/", songRoutes);

const PORT = process.env.PORT || 3002;
app.listen(PORT, async () => {
  runWithContext(
    { taskType: "server-task", taskId: generateTaskId() },
    async () => {
      log("info", `Server is running at http://localhost:${PORT}`);

      if (!process.env.CLIENT_URL) {
        log("error", "CLIENT_URL Environment variable not set.");
        process.exit(1);
      }

      if (!process.env.API_BASE_URL) {
        log("error", "API_BASE_URL Environment variable not set.");
        process.exit(1);
      }

      if (!process.env.JWT_SECRET) {
        log("error", "JWT_SECRET Environment variable not set.");
        process.exit(1);
      }

      if (!process.env.MONGO_URI) {
        log("error", "MONGO_URI Environment variable not set.");
        process.exit(1);
      }

      if (!process.env.SPOTIFY_CLIENT_ID) {
        log("error", "SPOTIFY_CLIENT_ID Environment variable not set.");
        process.exit(1);
      }

      if (!process.env.SPOTIFY_CLIENT_SECRET) {
        log("error", "SPOTIFY_CLIENT_SECRET Environment variable not set.");
        process.exit(1);
      }

      // Circumvent youtube ip blocking
      if (process.env.PROXY_LIST_URL) {
        log("info", "Using Proxies");
        await ProxyService.refreshProxyList();
      }

      // Choose initial songs
      if (process.env.INITIAL_TRACK_IDS) {
        const initialTrackIds = process.env.INITIAL_TRACK_IDS.split(",");
        log("info", `Using Initial Tracks: ${initialTrackIds}`);
        for (const trackId of initialTrackIds) {
          QueueService.addToSuggestionQueue(trackId);
        }
      } else {
        log(
          "warn",
          "No initial songs provided. Gathering suggested tracks from Spotify instead.",
        );
      }

      EventService.setMaxListeners(100);
      await DatabaseService.initialize();
      await RequestModelService.initialize();
      await AccountModelService.initialize();
      await SpotifyService.initialize();
      ClientManager.initialize();
      SongController.initialize();
    },
  );
});
