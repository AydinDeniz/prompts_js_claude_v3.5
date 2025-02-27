class MusicRecommender {
  constructor() {
    this.model = null;
    this.spotifyApi = null;
    this.userProfile = null;
    this.listeningHistory = [];
    this.recommendations = [];
    
    this.init();
  }

  async init() {
    await this.initializeSpotify();
    await this.loadMLModel();
    this.setupUI();
    await this.loadUserData();
    this.startPlaybackMonitoring();
  }

  async initializeSpotify() {
    this.spotifyApi = new Spotify.Web.Api({
      clientId: process.env.SPOTIFY_CLIENT_ID
    });

    const token = await this.getAccessToken();
    this.spotifyApi.setAccessToken(token);
  }

  async loadMLModel() {
    try {
      this.model = await tf.loadLayersModel('/models/music-recommender/model.json');
    } catch (error) {
      console.error('Failed to load ML model:', error);
    }
  }

  setupUI() {
    this.elements = {
      playerContainer: document.getElementById('player'),
      recommendationsList: document.getElementById('recommendations'),
      playlistContainer: document.getElementById('playlists'),
      genreFilters: document.getElementById('genre-filters'),
      moodSelector: document.getElementById('mood-selector')
    };

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.elements.moodSelector.addEventListener('change', () => {
      this.updateRecommendations();
    });

    this.elements.genreFilters.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        this.filterRecommendations();
      }
    });
  }

  async loadUserData() {
    try {
      const [profile, history] = await Promise.all([
        this.spotifyApi.getMe(),
        this.fetchListeningHistory()
      ]);

      this.userProfile = profile;
      this.listeningHistory = history;
      
      await this.generateRecommendations();
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  }

  async fetchListeningHistory() {
    const history = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await this.spotifyApi.getMyRecentlyPlayedTracks({
        limit,
        offset
      });

      if (!response.items.length) break;

      history.push(...response.items);
      offset += limit;

      if (response.items.length < limit) break;
    }

    return history;
  }

  async generateRecommendations() {
    if (!this.model || !this.listeningHistory.length) return;

    const features = await this.extractFeatures();
    const predictions = this.model.predict(features);
    const recommendedTracks = await this.processRecommendations(predictions);

    this.recommendations = recommendedTracks;
    this.updateRecommendationsUI();
  }

  async extractFeatures() {
    const audioFeatures = await Promise.all(
      this.listeningHistory.map(track => 
        this.spotifyApi.getAudioFeaturesForTrack(track.track.id)
      )
    );

    const features = audioFeatures.map(feature => [
      feature.danceability,
      feature.energy,
      feature.key,
      feature.loudness,
      feature.mode,
      feature.speechiness,
      feature.acousticness,
      feature.instrumentalness,
      feature.liveness,
      feature.valence,
      feature.tempo / 200 // Normalize tempo
    ]);

    return tf.tensor2d(features);
  }

  async processRecommendations(predictions) {
    const scores = predictions.dataSync();
    const trackIds = this.listeningHistory.map(item => item.track.id);
    
    const recommendations = await this.spotifyApi.getRecommendations({
      seed_tracks: trackIds.slice(0, 5),
      limit: 100
    });

    return recommendations.tracks.map((track, index) => ({
      ...track,
      score: scores[index] || 0
    })).sort((a, b) => b.score - a.score);
  }

  updateRecommendationsUI() {
    const mood = this.elements.moodSelector.value;
    const filteredRecs = this.filterByMood(this.recommendations, mood);

    this.elements.recommendationsList.innerHTML = filteredRecs
      .map(track => `
        <div class="track-card" data-id="${track.id}">
          <img src="${track.album.images[0].url}" alt="${track.name}">
          <div class="track-info">
            <h3>${track.name}</h3>
            <p>${track.artists.map(a => a.name).join(', ')}</p>
          </div>
          <div class="track-controls">
            <button onclick="recommender.playTrack('${track.id}')">
              Play
            </button>
            <button onclick="recommender.addToPlaylist('${track.id}')">
              Add to Playlist
            </button>
          </div>
        </div>
      `).join('');
  }

  filterByMood(tracks, mood) {
    const moodRanges = {
      happy: { minValence: 0.6, minEnergy: 0.5 },
      sad: { maxValence: 0.4, maxEnergy: 0.5 },
      energetic: { minEnergy: 0.7 },
      relaxed: { maxEnergy: 0.4, minValence: 0.3 }
    };

    return tracks.filter(async track => {
      const features = await this.spotifyApi.getAudioFeaturesForTrack(track.id);
      const range = moodRanges[mood];

      return Object.entries(range).every(([key, value]) => {
        if (key.startsWith('min')) {
          return features[key.slice(3).toLowerCase()] >= value;
        } else if (key.startsWith('max')) {
          return features[key.slice(3).toLowerCase()] <= value;
        }
        return true;
      });
    });
  }

  async playTrack(trackId) {
    try {
      await this.spotifyApi.play({
        uris: [`spotify:track:${trackId}`]
      });
    } catch (error) {
      console.error('Playback failed:', error);
    }
  }

  async addToPlaylist(trackId) {
    try {
      const playlistId = await this.getOrCreateRecommendationPlaylist();
      await this.spotifyApi.addTracksToPlaylist(playlistId, [`spotify:track:${trackId}`]);
      this.showNotification('Track added to playlist');
    } catch (error) {
      console.error('Failed to add track to playlist:', error);
    }
  }

  async getOrCreateRecommendationPlaylist() {
    const playlists = await this.spotifyApi.getUserPlaylists();
    const recommendationPlaylist = playlists.items.find(
      p => p.name === 'AI Recommendations'
    );

    if (recommendationPlaylist) {
      return recommendationPlaylist.id;
    }

    const newPlaylist = await this.spotifyApi.createPlaylist(
      this.userProfile.id,
      {
        name: 'AI Recommendations',
        description: 'Personalized recommendations powered by AI'
      }
    );

    return newPlaylist.id;
  }

  startPlaybackMonitoring() {
    setInterval(async () => {
      try {
        const current = await this.spotifyApi.getMyCurrentPlayingTrack();
        if (current) {
          this.updateNowPlaying(current);
          this.updateUserTaste(current);
        }
      } catch (error) {
        console.error('Playback monitoring error:', error);
      }
    }, 5000);
  }

  updateNowPlaying(track) {
    const nowPlaying = document.getElementById('now-playing');
    nowPlaying.innerHTML = `
      <img src="${track.album.images[0].url}" alt="${track.name}">
      <div class="track-info">
        <h4>${track.name}</h4>
        <p>${track.artists.map(a => a.name).join(', ')}</p>
      </div>
    `;
  }

  async updateUserTaste(track) {
    const features = await this.spotifyApi.getAudioFeaturesForTrack(track.id);
    const userTaste = JSON.parse(localStorage.getItem('userTaste') || '{}');
    
    Object.entries(features).forEach(([feature, value]) => {
      if (typeof value === 'number') {
        userTaste[feature] = (userTaste[feature] || 0) * 0.9 + value * 0.1;
      }
    });

    localStorage.setItem('userTaste', JSON.stringify(userTaste));
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Initialize recommender
const recommender = new MusicRecommender();