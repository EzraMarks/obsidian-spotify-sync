import { PluginManifest } from 'obsidian';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import ObsidianSpotify from '../main';
import { ObsidianSpotifySettings } from '../settings';

/**
 * Manages Spotify token refresh intervals and online/offline events.
 */
export class TokenManager {
	private plugin: ObsidianSpotify;
	private refreshInterval: NodeJS.Timer | null = null;
	private readonly TIMEOUT = 3000;
	private readonly REFRESH_INTERVAL = 3600000; // 1 hour

	// Event handlers (for cleanup)
	offlineHandler: (() => Promise<void>) | null = null;
	onlineHandler: (() => Promise<void>) | null = null;

	constructor(plugin: ObsidianSpotify) {
		this.plugin = plugin;
	}

	/**
	 * Starts token refresh and sets up event listeners.
	 */
	startTokenRefresh(settings: ObsidianSpotifySettings, manifest: PluginManifest): void {
		const refreshTokenFn = () => this.plugin.spotifyAuth.refreshToken(settings, manifest);
		const updateUsernameFn = () => this.plugin.spotifyAuth.updateDisplayedUsername(settings);

		const offlineHandler = async () => {
			console.log(`[${manifest.name}] Now offline, will refresh token when back online`);
			await updateUsernameFn();
		};

		const onlineHandler = async () => {
			console.log(`[${manifest.name}] Back online, refreshing token and resetting timer`);
			await refreshTokenFn();
			await updateUsernameFn();

			this.clearRefreshTimer();
			setTimeout(() => {
				this.startRefreshTimer(refreshTokenFn);
			}, this.TIMEOUT);
		};

		window.addEventListener("offline", offlineHandler);
		window.addEventListener("offline-custom", offlineHandler);
		window.addEventListener("online", onlineHandler);
		window.addEventListener("online-custom", onlineHandler);

		this.offlineHandler = offlineHandler;
		this.onlineHandler = onlineHandler;

		this.startRefreshTimer(refreshTokenFn);
		refreshTokenFn().catch(error => console.warn('Initial token refresh failed:', error));
	}

	/**
	 * Starts the token refresh timer.
	 */
	private startRefreshTimer(refreshTokenFn: () => Promise<void>): void {
		this.refreshInterval = setInterval(() => {
			refreshTokenFn().catch(error => console.warn('Token refresh failed:', error));
		}, this.REFRESH_INTERVAL);
	}

	/**
	 * Clears the current refresh timer.
	 */
	private clearRefreshTimer(): void {
		if (this.refreshInterval) {
			clearInterval(this.refreshInterval);
			this.refreshInterval = null;
		}
	}

	/**
	 * Cleans up all timers and event listeners.
	 */
	cleanup(): void {
		this.clearRefreshTimer();

		if (this.offlineHandler) {
			window.removeEventListener("offline", this.offlineHandler);
			window.removeEventListener("offline-custom", this.offlineHandler);
		}

		if (this.onlineHandler) {
			window.removeEventListener("online", this.onlineHandler);
			window.removeEventListener("online-custom", this.onlineHandler);
		}

		this.plugin.spotifyApi = undefined;

		console.log(`[${this.plugin.manifest.name}] Token manager cleaned up`);
	}
}
