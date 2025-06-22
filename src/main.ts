import { Platform, App, Editor, MarkdownView, Modal, Notice, Plugin, PluginManifest, PluginSettingTab, Setting, requestUrl, SettingTab } from 'obsidian';
import { SpotifyApi, AccessToken } from '@spotify/web-api-ts-sdk';
import { RefreshClass } from './refreshClass';
import { SpotifySyncEngine } from './spotifySyncEngine';


/**
 * Declares the global interface for the `window` object.
 */
declare global {
	interface Window {
		spotifysdk: SpotifyApi;
	}
}

/**
 * Represents the settings for the Obsidian Spotify integration.
 */
export interface ObsidianSpotifySettings {
	/**
	 * The client ID for the Spotify API.
	 */
	spotify_client_id: string;

	/**
	 * The client secret for the Spotify API.
	 */
	spotify_client_secret: string;

	/**
	 * The access token for authenticating requests to the Spotify API.
	 */
	spotify_access_token: AccessToken;
}

/**
 * Default settings for the Obsidian Spotify integration.
 */
const DEFAULT_SETTINGS: ObsidianSpotifySettings = {
	spotify_client_id: '',
	spotify_client_secret: '',
	spotify_access_token: {
		access_token: "",
		token_type: "",
		expires_in: 0,
		refresh_token: ""
	},
}

/**
 * Represents the ObsidianSpotify plugin.
 */
export default class ObsidianSpotify extends Plugin {
	spotifyrefreshtimer: NodeJS.Timer;
	settings: ObsidianSpotifySettings;
	manifest: PluginManifest;
	refreshtoken: any;
	fakenetevents: () => Promise<void>;
	spotify_auth_login_function: (spotify_client_id: string, manifest: PluginManifest) => void;
	spotify_auth_logout_function: (manifest: PluginManifest, this2: ObsidianSpotify) => Promise<void>;
	refreshname: (settings: ObsidianSpotifySettings) => Promise<void>;
	spotifystate: any;
	fakeneteventstimer: NodeJS.Timer;
	netstatus: boolean;
	refreshspot: (setting: ObsidianSpotifySettings, manifest: PluginManifest) => Promise<void>;
	usernametext: HTMLSpanElement;
	offlinerefresh: () => Promise<void>;
	onlinerefresh: () => Promise<void>;

	/**
	 * Called when the plugin is loaded.
	 */
	async onload() {
		if (Platform.isMobileApp) {
			this.fakenetevents = async () => {
				const checkConnection = async () => {
					try {
						const response = await requestUrl({
							url: "https://accounts.spotify.com",
						});

						return response.status >= 200 && response.status < 300;
					} catch (error) {
						return false;
					}
				};
				let online = await checkConnection();
				if (online == this.netstatus) {
					return;
				}
				this.netstatus = online;
				if (online) {
					let event = new CustomEvent("online");
					window.dispatchEvent(event);
				} else {
					let event = new CustomEvent("offline");
					window.dispatchEvent(event);
				}
			};
			this.fakeneteventstimer = setInterval(this.fakenetevents, 2000);
		}

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObsidianSpotifySettingsTab(this.app, this));
		await this.loadSettings();

		/**
		 * Refreshes the Spotify access token.
		 * @param setting - The ObsidianSpotifySettings object.
		 * @param manifest - The PluginManifest object.
		 */
		async function refreshspot(setting: ObsidianSpotifySettings, manifest: PluginManifest) {
			let json_spotify = setting.spotify_access_token;
			let refresh_token = json_spotify.refresh_token;
			let body = new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refresh_token,
				client_id: setting.spotify_client_id
			}).toString();
			try {
				let access_token = await requestUrl({
					"url": 'https://accounts.spotify.com/api/token',
					"method": "POST",
					"headers": {
						'content-type': 'application/x-www-form-urlencoded',
						'Authorization': 'Basic ' + (btoa(setting.spotify_client_id + ':' + setting.spotify_client_secret))
					},
					"body": body,
					"throw": false
				});
				let data = await access_token.json;

				console.log("[" + manifest.name + "] Spotify Token Refreshed");
				window.spotifysdk = SpotifyApi.withAccessToken(setting.spotify_client_id, data);
				window.spotifysdk['authenticationStrategy'].refreshTokenAction = async () => { return; };
			} catch {
				console.log("[" + manifest.name + "] Waiting for internet to update token")

			}
		}

		this.refreshspot = refreshspot;

		if (this.settings.spotify_access_token.refresh_token) {
			RefreshClass.refreshInit({ plugin: this, refreshspot, settings: this.settings, manifest: this.manifest });
		} else {
			(window.spotifysdk as any) = null;
		}

		/**
		 * Logs in the user with Spotify authentication.
		 * @param spotify_client_id - The Spotify client ID.
		 * @param manifest - The PluginManifest object.
		 */
		function spotify_auth_login(spotify_client_id: string, manifest: PluginManifest) {
			const generateRandomString = (length: number) => {
				const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
				const values = crypto.getRandomValues(new Uint8Array(length));
				return values.reduce((acc, x) => acc + possible[x % possible.length], "");
			}

			let state = generateRandomString(64);
			let scope = "user-follow-modify user-follow-read user-read-playback-position user-top-read user-read-recently-played user-library-modify user-library-read user-read-email user-read-private ugc-image-upload app-remote-control streaming playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state user-read-currently-playing user-modify-playback-state user-read-recently-played";
			let params = {
				response_type: 'code',
				client_id: spotify_client_id,
				scope,
				redirect_uri: "obsidian://spotify/auth",
				state: state
			};

			let endpoint = new URL('https://accounts.spotify.com/authorize');
			endpoint.search = new URLSearchParams(params).toString();
			window.location.assign(endpoint);
			this.spotifystate = state;
			console.log("[" + manifest.name + "] Opening login page");
		}

		/**
		 * Logs out the user from Spotify authentication.
		 * @param manifest - The PluginManifest object.
		 * @param this2 - The ObsidianSpotify object.
		 */
		async function spotify_auth_logout(manifest: PluginManifest, this2: ObsidianSpotify) {
			try {
				window.spotifysdk.logOut();
				console.log(this2);
				this2.settings.spotify_access_token = {
					access_token: "",
					token_type: "",
					expires_in: 0,
					refresh_token: ""
				};
				await this2.saveSettings();
				RefreshClass.logoutOrunload({ plugin: this, settings: this2.settings, manifest: manifest });
				console.log("[" + manifest.name + "] Logged out");
				try {
					this.refreshname(this2);
				} catch { }
			} catch { }
		}

		this.spotify_auth_login_function = spotify_auth_login;
		this.spotify_auth_logout_function = spotify_auth_logout;

		this.addCommand({
			id: "spotify-auth-login",
			name: "Login",
			callback: () => {
				this.spotify_auth_login_function(this.settings.spotify_client_id, this.manifest);
			}
		});
		this.addCommand({
			id: "spotify-auth-logout",
			name: "Logout",
			callback: async () => {
				let this2 = this;
				this.spotify_auth_logout_function(this.manifest, this2);
			}
		});

		this.addCommand({
			id: "spotify-full-sync",
			name: "Full Sync",
			callback: async () => {
				await this.sync();
			}
		});

		async function refreshname(settings: ObsidianSpotifySettings) {
			try {
				if (settings.spotify_access_token.access_token) {

					let data = await window.spotifysdk.currentUser.profile()
					this.usernametext.setText(data.display_name + " (" + data.id + ")")
				} else {
					this.usernametext.setText("Not logged in")
				}
			} catch (e) {
				this.usernametext.setText("Error getting username")
			}
		}

		this.refreshname = refreshname;

		this.registerObsidianProtocolHandler("spotify/auth", async (e) => {
			console.log("[" + this.manifest.name + "] Spotify Auth Code Received From Callback");
			let correctstate = this.spotifystate;
			let state = e.state;
			if (!(state == correctstate)) {
				console.log("[" + this.manifest.name + "] State mismatch");
				return;
			}
			let code = e.code;
			let body = new URLSearchParams({
				client_id: this.settings.spotify_client_id,
				grant_type: 'authorization_code',
				code,
				redirect_uri: "obsidian://spotify/auth",
			}).toString();
			let access_token = await requestUrl({
				"url": 'https://accounts.spotify.com/api/token',
				"method": "POST",
				"headers": {
					'content-type': 'application/x-www-form-urlencoded',
					'Authorization': 'Basic ' + (btoa(this.settings.spotify_client_id + ':' + this.settings.spotify_client_secret))
				},
				"body": body,
				"throw": false
			});
			let data = await access_token.json;
			this.settings.spotify_access_token = data;
			await this.saveSettings();
			window.spotifysdk = SpotifyApi.withAccessToken(this.settings.spotify_client_id, this.settings.spotify_access_token);
			window.spotifysdk['authenticationStrategy'].refreshTokenAction = async () => { return; };
			console.log("[" + this.manifest.name + "] Authed successfuly");
			RefreshClass.refreshInit({ plugin: this, refreshspot, settings: this.settings, manifest: this.manifest });
			try {
				this.refreshname(this.settings)
			} catch { }
		});
	}

	async sync() {
		if (!window.spotifysdk) {
			new Notice('Please login to Spotify first');
			return;
		}

		try {
			const syncManager = new SpotifySyncEngine(this.app, window.spotifysdk);
			await syncManager.syncAll();
		} catch (error) {
			console.error('Sync failed:', error);
			new Notice('Sync failed. Check console for details.');
		}
	}

	/**
	 * Called when the plugin is unloaded.
	 */
	onunload() {
		RefreshClass.logoutOrunload({ plugin: this, settings: this.settings, manifest: this.manifest });
		if (this.fakeneteventstimer) {
			clearInterval(this.fakeneteventstimer);
		}
	}

	/**
	 * Loads the plugin settings.
	 */
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	/**
	 * Saves the plugin settings.
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}
}



class ObsidianSpotifySettingsTab extends PluginSettingTab {
	plugin: ObsidianSpotify;
	static display: any;

	constructor(app: App, plugin: ObsidianSpotify) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		let manifest = this.plugin.manifest;

		containerEl.empty();
		new Setting(containerEl)
			.setName('Spotify Client ID')
			.setDesc('Find it in your spotify developer dashboard')
			.addText(text => text
				.setPlaceholder('Enter your client ID')
				.setValue(this.plugin.settings.spotify_client_id)
				.onChange(async (value) => {
					this.plugin.settings.spotify_client_id = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Spotify Client secret')
			.setDesc('Find it in your spotify developer dashboard')
			.addText(text => text
				.setPlaceholder('Enter your client secret')
				.setValue(this.plugin.settings.spotify_client_secret)
				.onChange(async (value) => {
					this.plugin.settings.spotify_client_secret = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Spotify Authentification')
			.setDesc('Login or logout from spotify')
			.addButton((btn) => btn
				.setButtonText("Login")
				.setCta()
				.onClick(async () => {
					this.plugin.spotify_auth_login_function(this.plugin.settings.spotify_client_id, manifest);

				}))
			.addButton((btn) => btn
				.setButtonText("Logout")
				.setCta()
				.onClick(async () => {

					this.plugin.spotify_auth_logout_function(manifest, this.plugin);

				}))

		const usernamecontainer = new Setting(containerEl)
			.setName('Logged in as')
			.setDesc('The current logged in user')

		const usernamewrapcontainer = usernamecontainer.controlEl.createDiv("spotify-api-refresh-token");
		const usernametext = usernamewrapcontainer.createSpan()

		this.plugin.usernametext = usernametext;
		this.plugin.refreshname(this.plugin.settings);
	}
}
