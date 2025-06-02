import axios from "axios";
import QueueService from "./QueueService.js";
import TrackModelService from "./db/TrackModelService.js";
import HistoryModelService from "./db/HistoryModelService.js";
import { log } from "../utils/logger.js";
import LastFMService from "./LastFMService.js";

class SpotifyService {
  constructor() {
    this._baseUrl = "https://api.spotify.com/v1";
    this._clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this._clientId = process.env.SPOTIFY_CLIENT_ID;
  }

  async initialize() {
    await this._authenticate();
  }

  async _authenticate() {
    try {
      const response = await axios.post(
        "https://accounts.spotify.com/api/token",
        null,
        {
          params: {
            grant_type: "client_credentials",
          },
          headers: {
            Authorization: `Basic ${Buffer.from(`${this._clientId}:${this._clientSecret}`).toString("base64")}`,
          },
        },
      );
      this.token = response.data.access_token;
      log("info", "Authenticated with Spotify API", this.constructor.name);
    } catch (error) {
      throw new Error("Failed to authenticate with Spotify API:", error);
    }
  }

  _extractMetadata(spotifyTrackMetadata) {
    log(
      "info",
      `Extracting metadata for: ${spotifyTrackMetadata.name}`,
      this.constructor.name,
    );
    return {
      trackId: spotifyTrackMetadata.id,
      title: spotifyTrackMetadata.name,
      artist: spotifyTrackMetadata.artists[0].name,
      album: spotifyTrackMetadata.album.name,
      genres: spotifyTrackMetadata.genres,
      releaseDate: spotifyTrackMetadata.album.release_date,
      url: spotifyTrackMetadata.external_urls.spotify,
      artUrl: spotifyTrackMetadata.album.images[0].url,
    };
  }

  async _getArtistGenres(artistId) {
    log(
      "info",
      `Getting genres for artist: ${artistId}`,
      this.constructor.name,
    );
    try {
      const artistResponse = await axios.get(
        `${this._baseUrl}/artists/${artistId}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        },
      );
      return artistResponse.data.genres;
    } catch (error) {
      throw new Error("Failed to get artist genres:", error);
    }
  }

  async searchTrack(query, limit=5) {
    try {
      log("info", `Searching for track: ${query}`, this.constructor.name);
      const response = await axios.get(`${this._baseUrl}/search`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        params: {
          q: query,
          type: "track",
          limit: limit,
        },
      });

      if (response.data.tracks.items.length === 0) {
        return;
      }
      const tracks = await Promise.all(
        response.data.tracks.items.map(
          async (track) =>
            await this._convertAndSaveSpotifyTrackMetadata(track),
        ),
      );
      return tracks;
    } catch (error) {
      if (error.response?.status === 401) {
        await this._authenticate();
        return this.searchTrack(query);
      }
      throw new Error("Failed to search for track:", error);
    }
  }

  async getRecommendations(trackMetadatas) {
    try {
      const totalRecommendations = 15;
      const perTrackLimit = Math.ceil(
        totalRecommendations / trackMetadatas.length,
      );

      const recommendations = new Set();

      for (const track of trackMetadatas) {
        // Spotify has deprecated the recommendation endpoint
        // Workaround: use the search endpoint for per-song recommendations
        // for each track.
        const response = await axios.get(`${this._baseUrl}/search`, {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
          params: {
            q: `track:${track.title} artist:${track.artist}`,
            type: "track",
            limit: perTrackLimit + 1,
          },
        });

        const trackResults = response.data.tracks.items;
        trackResults.forEach((recommendedTrack) => {
          if (
            !recommendations.has(recommendedTrack.id) &&
            recommendations.size < totalRecommendations &&
            recommendedTrack.id !== track.trackId
          ) {
            recommendations.add(recommendedTrack.id);
          }
        });

        if (recommendations.size >= totalRecommendations) break;
      }

      return Array.from(recommendations);
    } catch (error) {
      if (error.response?.status === 401) {
        await this._authenticate();
        return this.getRecommendations(trackMetadatas);
      }
      throw new Error("Failed to get recommendations:", error);
    }
  }

  _cleanOtherPlatformLinks(links) {
    const cleanedLinks = {};

    // key is the platform name (e.g 'deezer') value is the url
    for (const [key, value] of Object.entries(links)) {
      cleanedLinks[key] = value.url;
    }

    return cleanedLinks;
  }

  async _getUrlForAllPlatforms(trackUrl) {
    log(
      "info",
      `Getting other platform links for: ${trackUrl}`,
      this.constructor.name,
    );
    try {
      const response = await axios.get(
        `https://api.song.link/v1-alpha.1/links?url=${trackUrl}`,
      );
      const link = response.data.linksByPlatform;
      return this._cleanOtherPlatformLinks(link);
    } catch (error) {
      throw new Error("Failed to get other platform links:", error);
    }
  }

  async _convertAndSaveSpotifyTrackMetadata(spotifyTrackMetadata) {
    const existingTrack = await TrackModelService.getSongMetadata(
      spotifyTrackMetadata.id,
    );

    if (existingTrack) {
      return existingTrack;
    }

    const artistId = spotifyTrackMetadata.artists[0].id;
    const url = spotifyTrackMetadata.external_urls.spotify;

    const genres = await this._getArtistGenres(artistId);
    const urlForPlatform = await this._getUrlForAllPlatforms(url);

    const cleanedTrackMetadata = this._extractMetadata(spotifyTrackMetadata);
    const trackData = {
      ...cleanedTrackMetadata,
      genres,
      urlForPlatform,
    };

    TrackModelService.saveSongMetadata(trackData);
    return trackData;
  }

  async getTrackData(trackId) {
    log("info", `Getting track data for: ${trackId}`, this.constructor.name);
    try {
      const response = await axios.get(`${this._baseUrl}/tracks/${trackId}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });
      if (!response.data) {
        return;
      }
      return await this._convertAndSaveSpotifyTrackMetadata(response.data);
    } catch (error) {
      if (error.response?.status === 401) {
        await this._authenticate();
        return this.getTrackData(trackId);
      }
      log("error", `Failed to get track data: ${error}`, this.constructor.name);
    }
  }

  async populateSuggestionQueue(numberOfSuggestions = 2) {
    // Get recommendations based on last five played
    const lastFiveSongs =
      await HistoryModelService.fetchMostRecentlyPlayedTracks(1, 5);

    let suggestions = await LastFMService.getRecommendations(
      lastFiveSongs.map((song) => ({
        title: song.title,
        artist: song.artist,
      })),
    );

    // from these lastfm recommendations, we need to get the spotify trackid
    // suggestions is formatted as [{artist:...,title:...}]
    suggestions = await Promise.all(
      suggestions.map(async (track) => {
        const spotifyTrack = await this.searchTrack(
          `${track.title} ${track.artist}`,
          1,
        );
        return spotifyTrack?.[0]?.trackId;
      }),
    );

    // Do not suggest songs that have been played in the last two hours
    const tooRecentlyPlayed =
      await HistoryModelService.fetchRecentlyPlayedTracks(2);
    const tooRecentlyTrackIds = tooRecentlyPlayed.map((track) => track.trackId);
    suggestions = suggestions.filter(
      (track) => !tooRecentlyTrackIds.includes(track),
    );


    // Limit to 5 suggestions
    suggestions = suggestions.slice(0, numberOfSuggestions);
    suggestions.forEach((track) => QueueService.addToSuggestionQueue(track));
  }
}

export default new SpotifyService();
