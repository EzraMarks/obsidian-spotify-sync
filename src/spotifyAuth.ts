import { PluginManifest, requestUrl } from 'obsidian';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { ObsidianSpotifySettings } from './settings';
import ObsidianSpotify from './main';

/**
 * Handles all Spotify authentication operations including OAuth flow, token refresh, and user management.
 */
export class SpotifyAuth {
    private plugin: ObsidianSpotify;
    private manifest: PluginManifest;

    constructor(plugin: ObsidianSpotify, manifest: PluginManifest) {
        this.plugin = plugin;
        this.manifest = manifest;
    }

    /**
     * Refreshes the Spotify access token using the refresh token.
     * @param settings - The plugin settings containing auth credentials
     * @param manifest - The plugin manifest for logging
     */
    async refreshToken(settings: ObsidianSpotifySettings, manifest: PluginManifest): Promise<void> {
        const jsonSpotify = settings.spotify_access_token;
        const refreshToken = jsonSpotify.refresh_token;

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: settings.spotify_client_id
        }).toString();

        try {
            const response = await requestUrl({
                url: 'https://accounts.spotify.com/api/token',
                method: "POST",
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + btoa(`${settings.spotify_client_id}:${settings.spotify_client_secret}`)
                },
                body: body,
                throw: false
            });

            const data = await response.json;

            console.log(`[${manifest.name}] Spotify Token Refreshed`);
            this.plugin.spotifyApi = SpotifyApi.withAccessToken(settings.spotify_client_id, data);
            this.plugin.spotifyApi['authenticationStrategy'].refreshTokenAction = async () => { return; };
        } catch (error) {
            console.log(`[${manifest.name}] Waiting for internet to update token`);
        }
    }

    /**
     * Initiates the Spotify OAuth login flow.
     * @param clientId - The Spotify client ID
     * @param manifest - The plugin manifest for logging
     * @returns The generated state for OAuth verification
     */
    initiateLogin(clientId: string, manifest: PluginManifest): string {
        const state = this.generateRandomString(64);
        const scope = "user-follow-modify user-follow-read user-read-playback-position user-top-read user-read-recently-played user-library-modify user-library-read user-read-email user-read-private ugc-image-upload app-remote-control streaming playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state user-read-currently-playing user-modify-playback-state user-read-recently-played";

        const params = {
            response_type: 'code',
            client_id: clientId,
            scope,
            redirect_uri: "obsidian://spotify/auth",
            state: state
        };

        const endpoint = new URL('https://accounts.spotify.com/authorize');
        endpoint.search = new URLSearchParams(params).toString();

        window.location.assign(endpoint);
        console.log(`[${manifest.name}] Opening login page`);

        return state;
    }

    /**
     * Handles the OAuth callback and exchanges the authorization code for tokens.
     * @param code - Authorization code from Spotify
     * @param settings - Plugin settings
     * @returns The access token data
     */
    async handleAuthCallback(code: string, settings: ObsidianSpotifySettings): Promise<any> {
        const body = new URLSearchParams({
            client_id: settings.spotify_client_id,
            grant_type: 'authorization_code',
            code,
            redirect_uri: "obsidian://spotify/auth",
        }).toString();

        const response = await requestUrl({
            url: 'https://accounts.spotify.com/api/token',
            method: "POST",
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(`${settings.spotify_client_id}:${settings.spotify_client_secret}`)
            },
            body: body,
            throw: false
        });

        return await response.json;
    }

    /**
     * Logs out the user and cleans up authentication state.
     * @param manifest - The plugin manifest for logging
     */
    async logout(manifest: PluginManifest): Promise<void> {
        try {
            if (this.plugin.spotifyApi) {
                this.plugin.spotifyApi.logOut();
            }

            this.plugin.settings.spotify_access_token = {
                access_token: "",
                token_type: "",
                expires_in: 0,
                refresh_token: ""
            };

            this.plugin.spotifyApi = undefined;
            await this.plugin.saveSettings();
            console.log(`[${manifest.name}] Logged out`);

            try {
                await this.updateDisplayedUsername(this.plugin.settings);
            } catch (error) {
                console.warn('Failed to update username display after logout:', error);
            }
        } catch (error) {
            console.error('Error during logout:', error);
        }
    }

    /**
     * Updates the displayed username in the settings UI.
     * @param settings - Plugin settings
     */
    async updateDisplayedUsername(settings: ObsidianSpotifySettings): Promise<void> {
        try {
            if (settings.spotify_access_token.access_token && this.plugin.spotifyApi) {
                const userData = await this.plugin.spotifyApi.currentUser.profile();
                if (this.plugin.usernametext) {
                    this.plugin.usernametext.setText(`${userData.display_name} (${userData.id})`);
                }
            } else {
                if (this.plugin.usernametext) {
                    this.plugin.usernametext.setText("Not logged in");
                }
            }
        } catch (error) {
            console.error('Error getting username:', error);
            if (this.plugin.usernametext) {
                this.plugin.usernametext.setText("Error getting username");
            }
        }
    }

    /**
     * Initializes the Spotify SDK with the current access token.
     * @param settings - Plugin settings containing the access token
     * @returns The initialized SpotifyApi instance or undefined
     */
    initializeSpotifySDK(settings: ObsidianSpotifySettings): SpotifyApi | undefined {
        if (settings.spotify_access_token.access_token) {
            const api = SpotifyApi.withAccessToken(settings.spotify_client_id, settings.spotify_access_token);
            api['authenticationStrategy'].refreshTokenAction = async () => { return; };
            return api;
        } else {
            return undefined;
        }
    }

    /**
     * Checks if the user is currently authenticated.
     * @param settings - Plugin settings
     * @returns True if user has a valid refresh token
     */
    isAuthenticated(settings: ObsidianSpotifySettings): boolean {
        return !!(settings.spotify_access_token.refresh_token);
    }

    /**
     * Generates a random string for OAuth state parameter.
     * @param length - Length of the random string
     * @returns Random string
     */
    private generateRandomString(length: number): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return values.reduce((acc, x) => acc + possible[x % possible.length], "");
    }
}
