import * as vscode from 'vscode';

import { apiUrl } from './config';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code?: string,
		readonly body?: unknown,
	) {
		super(message);
	}
	get isNetwork() {
		return this.status === 0;
	}
}

interface Session {
	accessToken: string;
	refreshToken: string;
}

const SECRET = 'selyh.session';
const LOCK = 'selyh.refreshLock';
const LOCK_MS = 15_000;

/**
 * Cliente de la API. La sesión vive en el almacén cifrado de VS Code (SecretStorage), compartido
 * por todas las ventanas. El refresh token es de UN solo uso: reusarlo revoca la sesión, así que
 * las rotaciones se deduplican dentro de la ventana y se coordinan entre ventanas con un candado.
 */
export class Api {
	private refreshing?: Promise<boolean>;
	readonly onSignedOut = new vscode.EventEmitter<void>();

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly shared: vscode.Memento,
	) {}

	private async session(): Promise<Session | undefined> {
		const raw = await this.secrets.get(SECRET);
		try {
			return raw ? (JSON.parse(raw) as Session) : undefined;
		} catch {
			return undefined;
		}
	}

	async linked() {
		return (await this.session()) !== undefined;
	}

	async saveSession(s: Session) {
		await this.secrets.store(SECRET, JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }));
	}

	async clearSession() {
		await this.secrets.delete(SECRET);
	}

	/** Revoca la sesión en el servidor (si hay red) y la borra de este equipo. */
	async logout() {
		const s = await this.session();
		if (s) {
			await this.raw('POST', '/auth/logout', { refreshToken: s.refreshToken }).catch(() => undefined);
		}
		await this.clearSession();
	}

	/** Sin sesión (vincular, refrescar). */
	anon<T = unknown>(method: string, path: string, body?: unknown) {
		return this.raw<T>(method, path, body);
	}

	async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
		const s = await this.session();
		if (!s) {
			throw new ApiError(401, 'Vincula tu cuenta de Selyh.', 'UNLINKED');
		}
		try {
			return await this.raw<T>(method, path, body, s.accessToken);
		} catch (e) {
			if (!(e instanceof ApiError) || e.status !== 401) {
				throw e;
			}
		}
		if (!(await this.rotate(s.refreshToken))) {
			throw new ApiError(401, 'Tu sesión venció. Vuelve a vincular tu cuenta.', 'UNLINKED');
		}
		const fresh = await this.session();
		return this.raw<T>(method, path, body, fresh?.accessToken);
	}

	private rotate(used: string): Promise<boolean> {
		this.refreshing ??= this.rotateShared(used).finally(() => (this.refreshing = undefined));
		return this.refreshing;
	}

	private async rotateShared(used: string): Promise<boolean> {
		// ¿Otra ventana ya lo rotó o lo está rotando? Se espera su resultado en vez de reusar el token.
		const deadline = Date.now() + LOCK_MS;
		while (Date.now() < deadline) {
			const now = await this.session();
			if (!now) {
				return false;
			}
			if (now.refreshToken !== used) {
				return true;
			}
			const lock = this.shared.get<number>(LOCK, 0);
			if (lock < Date.now()) {
				break;
			}
			await new Promise((r) => setTimeout(r, 400));
		}
		await this.shared.update(LOCK, Date.now() + LOCK_MS);
		try {
			const t = await this.raw<Session>('POST', '/auth/refresh', { refreshToken: used });
			await this.saveSession(t);
			return true;
		} catch (e) {
			if (e instanceof ApiError && !e.isNetwork && e.status < 500) {
				await this.clearSession();
				this.onSignedOut.fire();
				return false;
			}
			throw e; // sin red: la sesión sigue siendo válida
		} finally {
			await this.shared.update(LOCK, 0);
		}
	}

	private async raw<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
		let res: Response;
		try {
			res = await fetch(`${apiUrl()}${path}`, {
				method,
				headers: {
					'content-type': 'application/json',
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(20_000),
			});
		} catch {
			throw new ApiError(0, 'Sin conexión con Selyh. Lo intentamos de nuevo más tarde.');
		}
		const text = await res.text();
		let json: unknown = undefined;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch {
			/* respuesta sin JSON */
		}
		if (!res.ok) {
			const b = (json ?? {}) as { message?: string | string[]; code?: string; error?: string };
			const msg = Array.isArray(b.message) ? b.message.join('. ') : b.message;
			throw new ApiError(res.status, messageFor(res.status, b.code, msg), b.code ?? b.error, json);
		}
		return json as T;
	}
}

function messageFor(status: number, code?: string, msg?: string) {
	if (code === 'CONSENT_REQUIRED') {
		return 'Falta activar un permiso para esto.';
	}
	if (status === 429) {
		return 'Demasiados intentos. Espera un momento.';
	}
	if (status >= 500) {
		return 'Selyh tuvo un problema. Inténtalo en un rato.';
	}
	return msg || 'No se pudo completar. Inténtalo de nuevo.';
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
