/**
 * Actividad del editor, calculada aquí y resumida por día. Solo se cuentan eventos (tecleo, cambio
 * de archivo, foco) para saber CUÁNTO tiempo estuviste activo: nunca qué escribiste ni dónde.
 * Lógica pura, sin `vscode`, para poder probarla.
 */

export interface WorkHours {
	start: string; // "09:00"
	end: string; // "18:00"
	weekends: boolean;
}

/** Acumulado de un día en UNA ventana de VS Code (cada ventana guarda el suyo y se suman al enviar). */
export interface DayActivity {
	activeSecs: number;
	afterHoursSecs: number;
	longestStreakSecs: number;
	streakSecs: number;
	lastEventAt?: number; // ms
}

/** Entre dos eventos, como mucho este tiempo cuenta como activo (leer código también es trabajar). */
export const ACTIVE_GAP_SECS = 120;
/** Un silencio de esta duración corta la racha continua: es una pausa real. */
export const BREAK_SECS = 5 * 60;

export const emptyDay = (): DayActivity => ({ activeSecs: 0, afterHoursSecs: 0, longestStreakSecs: 0, streakSecs: 0 });

const toMin = (hhmm: string) => {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** ¿`d` cae fuera del horario laboral? Admite horarios que cruzan la medianoche. */
export function isAfterHours(d: Date, wh: WorkHours): boolean {
	const day = d.getDay();
	if (!wh.weekends && (day === 0 || day === 6)) {
		return true;
	}
	const s = toMin(wh.start);
	const e = toMin(wh.end);
	if (s === null || e === null || s === e) {
		return false;
	}
	const m = d.getHours() * 60 + d.getMinutes();
	return s < e ? m < s || m >= e : m < s && m >= e;
}

/** Registra un evento de actividad en `now`. Devuelve true si venías de una pausa real (≥ 5 min). */
export function record(day: DayActivity, now: Date, wh: WorkHours): boolean {
	const t = now.getTime();
	const gap = day.lastEventAt === undefined ? Infinity : (t - day.lastEventAt) / 1000;
	day.lastEventAt = t;
	if (gap < 0) {
		return false; // reloj que retrocede: se ignora este tramo
	}
	if (gap <= ACTIVE_GAP_SECS) {
		day.activeSecs += gap;
		day.streakSecs += gap;
		if (isAfterHours(now, wh)) {
			day.afterHoursSecs += gap;
		}
		day.longestStreakSecs = Math.max(day.longestStreakSecs, day.streakSecs);
		return false;
	}
	const wasBreak = gap >= BREAK_SECS && gap !== Infinity;
	if (gap >= BREAK_SECS) {
		day.streakSecs = 0;
	}
	return wasBreak;
}

/** Suma las ventanas de un mismo día: tiempo activo y fuera de horario se suman; la racha es la mayor. */
export function merge(parts: DayActivity[]): DayActivity {
	const out = emptyDay();
	for (const p of parts) {
		out.activeSecs += p.activeSecs;
		out.afterHoursSecs += p.afterHoursSecs;
		out.longestStreakSecs = Math.max(out.longestStreakSecs, p.longestStreakSecs);
	}
	return out;
}

/** Lo único que se envía: tres números por día (las claves que usa el estimado de la API). */
export function metrics(d: DayActivity) {
	return {
		hoursActive: Math.round((d.activeSecs / 3600) * 100) / 100,
		afterHoursMinutes: Math.round(d.afterHoursSecs / 60),
		longestStreakMinutes: Math.round(d.longestStreakSecs / 60),
	};
}

/** Día local AAAA-MM-DD. */
export function localDay(d = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
