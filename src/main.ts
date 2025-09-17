import { Platform, App, Editor, MarkdownView, Modal, Notice, Plugin, PluginManifest, PluginSettingTab, Setting, requestUrl, SettingTab } from 'obsidian';
import { SpotifyApi, AccessToken } from '@spotify/web-api-ts-sdk';
import { SpotifySyncEngine } from './spotifySyncEngine';
import { ObsidianSpotifySettings, DEFAULT_SETTINGS, ObsidianSpotifySettingsTab } from './settings';
import { SpotifyAuth } from './spotifyAuth';
import { TokenManager } from './tokenManager';

/**
 * Main Obsidian Spotify plugin class.
 * Orchestrates authentication, syncing, and settings management.
 */
export default class ObsidianSpotify extends Plugin {
	spotifyAuth: SpotifyAuth;
	tokenManager: TokenManager;
	spotifyApi: SpotifyApi | undefined;
	settings: ObsidianSpotifySettings;
	manifest: PluginManifest;
	usernametext: HTMLSpanElement;
	spotifystate: string;

	// Mobile network detection
	private networkCheckTimer: NodeJS.Timer | null = null;
	private isOnline: boolean = true;

	/**
	 * Called when the plugin is loaded.
	 */
	async onload() {
		this.spotifyAuth = new SpotifyAuth(this, this.manifest);
		this.tokenManager = new TokenManager(this);

		this.initializeNetworkDetection();

		await this.loadSettings();
		this.addSettingTab(new ObsidianSpotifySettingsTab(this.app, this));

		if (this.spotifyAuth.isAuthenticated(this.settings)) {
			this.spotifyApi = this.spotifyAuth.initializeSpotifySDK(this.settings);
			this.tokenManager.startTokenRefresh(this.settings, this.manifest);
		} else {
			this.spotifyApi = undefined;
		}

		this.registerCommands();
		this.registerAuthProtocolHandler();

		// Auto-sync on load if enabled
		if (this.settings.auto_sync_on_load && this.spotifyApi) {
			setTimeout(async () => {
				await this.sync();
			}, 5000); // Wait 5 seconds after plugin load
		}
	}

	/**
	 * Initialize simple mobile network detection.
	 */
	private initializeNetworkDetection(): void {
		if (Platform.isMobileApp) {
			const checkConnection = async () => {
				try {
					const response = await requestUrl({
						url: "https://accounts.spotify.com"
					});
					const nowOnline = response.status >= 200 && response.status < 300;

					if (nowOnline !== this.isOnline) {
						this.isOnline = nowOnline;
						const eventType = nowOnline ? "online-custom" : "offline-custom";
						window.dispatchEvent(new CustomEvent(eventType));
					}
				} catch (error) {
					if (this.isOnline) {
						this.isOnline = false;
						window.dispatchEvent(new CustomEvent("offline-custom"));
					}
				}
			};

			this.networkCheckTimer = setInterval(() => {
				checkConnection().catch(error => {
					console.warn('Network check failed:', error);
				});
			}, 2000);
		}
	}

	/**
	 * Registers plugin commands.
	 */
	private registerCommands(): void {
		this.addCommand({
			id: "spotify-auth-login",
			name: "Login",
			callback: () => {
				this.spotifystate = this.spotifyAuth.initiateLogin(this.settings.spotify_client_id, this.manifest);
			}
		});

		this.addCommand({
			id: "spotify-auth-logout",
			name: "Logout",
			callback: async () => {
				await this.spotifyAuth.logout(this.manifest);
				this.tokenManager.cleanup();
			}
		});

		this.addCommand({
			id: "spotify-full-sync",
			name: "Full Sync",
			callback: async () => {
				await this.sync();
			}
		});
	}

	/**
	 * Registers the OAuth protocol handler for Spotify authentication.
	 */
	private registerAuthProtocolHandler(): void {
		this.registerObsidianProtocolHandler("spotify/auth", async (e) => {
			console.log(`[${this.manifest.name}] Spotify Auth Code Received From Callback`);

			const correctState = this.spotifystate;
			const state = e.state;

			if (state !== correctState) {
				console.log(`[${this.manifest.name}] State mismatch`);
				return;
			}

			try {
				const tokenData = await this.spotifyAuth.handleAuthCallback(e.code, this.settings);

				this.settings.spotify_access_token = tokenData;
				await this.saveSettings();

				this.spotifyApi = this.spotifyAuth.initializeSpotifySDK(this.settings);

				console.log(`[${this.manifest.name}] Authenticated successfully`);

				this.tokenManager.startTokenRefresh(this.settings, this.manifest);

				try {
					await this.spotifyAuth.updateDisplayedUsername(this.settings);
				} catch (error) {
					console.warn('Failed to update username display after auth:', error);
				}

			} catch (error) {
				console.error('Authentication failed:', error);
				new Notice('Spotify authentication failed. Check console for details.');
			}
		});
	}

	/**
	 * Performs a full sync of Spotify data.
	 */
	async sync(): Promise<void> {
		if (!this.spotifyApi) {
			new Notice('Please login to Spotify first');
			return;
		}

		try {
			const syncManager = new SpotifySyncEngine(this.app, this.spotifyApi, this.settings);
			await syncManager.syncAll();
		} catch (error) {
			console.error('Sync failed:', error);
			new Notice('Sync failed. Check console for details.');
		}
	}

	/**
	 * Called when the plugin is unloaded.
	 */
	onunload(): void {
		this.tokenManager.cleanup();

		if (this.networkCheckTimer) {
			clearInterval(this.networkCheckTimer);
			this.networkCheckTimer = null;
		}

		console.log(`[${this.manifest.name}] Plugin unloaded and cleaned up`);
	}

	/**
	 * Loads the plugin settings.
	 */
	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Saves the plugin settings.
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
