import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginManifest, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import ObsidianSpotify, { ObsidianSpotifySettings } from './main';

/**
 * Class responsible for refreshing the Spotify token and managing event listeners.
 */
export class RefreshClass {
	/**
	 * Refreshes the Spotify token and sets up event listeners for online and offline events.
	 * @param args - The arguments required for refreshing the token and managing event listeners.
	 * @param args.sharedstuff - An object for storing shared data.
	 * @param args.refreshspot - A function for refreshing the Spotify token.
	 * @param args.settings - The settings for the Obsidian Spotify plugin.
	 * @param args.manifest - The plugin manifest.
	 */
	static async refreshInit(args: {
		plugin: ObsidianSpotify;
		refreshspot: Function;
		settings: ObsidianSpotifySettings;
		manifest: PluginManifest;
	}) {
		const {plugin, refreshspot, settings, manifest} = args;

		var TIMEOUT = 3000;

		plugin.offlinerefresh = async () => {
			console.log("[" + manifest.name + "] Now offline, refreshing Spotify Token after online and resetting timer");
			plugin.refreshname(settings)
		};

		window.addEventListener("offline", plugin.offlinerefresh);
		window.addEventListener("offline-custom", plugin.offlinerefresh);

		plugin.onlinerefresh = async () => {
			console.log("[" + manifest.name + "] Refreshing Spotify Token after online and resetting timer");
			await refreshspot(settings, manifest);
			plugin.refreshname(settings);
			clearInterval(plugin.spotifyrefreshtimer);
			setTimeout(async () => {
				let spotifyrefreshtimer = setInterval(async () => {
					await refreshspot(settings, manifest);
				}, 3600000);
				plugin.spotifyrefreshtimer =  spotifyrefreshtimer;
			}, TIMEOUT);
		};

		window.addEventListener("online", plugin.onlinerefresh);
		window.addEventListener("online-custom", plugin.onlinerefresh);

		
		let spotifyrefreshtimer = setInterval(async () => {
			await refreshspot(settings, manifest);
		}, 3600000);
		plugin.spotifyrefreshtimer = spotifyrefreshtimer;
		await refreshspot(settings, manifest);
	}

	/**
	 * Cleans up the Spotify SDK and auto token refresher.
	 * @param args - The arguments required for cleaning up.
	 * @param args.sharedstuff - An object for storing shared data.
	 * @param args.settings - The settings for the Obsidian Spotify plugin.
	 * @param args.manifest - The plugin manifest.
	 */
	static async logoutOrunload(args: {
		plugin: ObsidianSpotify;
		settings: ObsidianSpotifySettings;
		manifest: PluginManifest;
	}) {
		const {plugin, settings, manifest} = args;

		(window.spotifysdk as any) = null;
		clearInterval(plugin.spotifyrefreshtimer);
		window.removeEventListener("offline", plugin.offlinerefresh);
		window.removeEventListener("offline-custom", plugin.offlinerefresh);
		window.removeEventListener("online", plugin.onlinerefresh);
		window.removeEventListener("online-custom", plugin.onlinerefresh);
		console.log("[" + manifest.name + "] Both the Spotify SDK and auto token refresher have been cleaned up");
	}
}
