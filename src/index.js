import express from 'express';
import songRoutes from './routes/routes.js';
import SongController from './controllers/songController.js';
import SpotifyService from './services/spotify.js';
import ProxyService from './services/proxy.js';
import path from 'path';

const app = express();
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.json());
app.use('/', songRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  if (process.env.USE_PROXIES) {
    console.log('Using proxies');
    await ProxyService.refreshProxyList();
  }
  await SpotifyService.authenticate();
  await SongController.getNextSong();
  SongController.player();
});
