# AL Radio Server

The server for AL Radio.

## Setup

- `npm i`
- `pip install -r requirements.txt`.
- FFmpeg: `brew install ffmpeg` or your system equivalent.

### Use Local Database

- Get MongoDB: `brew tap mongodb/brew && brew install mongodb-community` or your system equivalent.
- `npm run mongo`

Add `mongodb://localhost:28017` to the `MONGO_URI` environment variable:

```conf
# .env
MONGO_URI=mongodb://localhost:28017
```

### Use Hosted Database

Add your MongoDB URI to the `MONGO_URI` environment variable:

```conf
# .env
MONGO_URI=mongodb+srv://{username}:{password}@{appname}.s04om.mongodb.net/...
```

### Environment Variables

#### Required

These are all required for AL Radio to function.

```conf
# .env

CLIENT_URL=http://localhost:3000
API_BASE_URL=http://localhost:3002
JWT_SECRET=test-secret-key # make this secure in production

MONGO_URI=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_CLIENT_ID=

# Required for first run
INITIAL_TRACK_IDS= # comma separated Spotify Track IDs
```

#### Optional

These

```conf
# .env

# Required for first run
INITIAL_TRACK_IDS= # comma separated Spotify Track IDs

# Required for OpenAI features
OPENAI_API_KEY=

# Required for LastFM features
LASTFM_API_KEY=
LASTFM_API_SECRET=

# Choose where the music is downloaded from. appleMusic requires
# a cookies.txt file in the root. see gamdl on github.
DOWNLOAD_SOURCE=appleMusic/youtube

# Required for YouTube IP blocking circumventing
PROXY_LIST_URL= # returns \r\n-separated proxies

# Optional
PORT= # default: 3002
ENVIRONMENT= # 'dev' or 'prod'
```

## Run

- `npm run mongo` if using a local DB
- `npm run start:local`
