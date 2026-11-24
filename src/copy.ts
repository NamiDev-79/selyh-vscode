/** Textos de la extensión. Tono de marca: cercano, breve, sin alarmas ni lenguaje clínico. */

export const scale = [
	{ value: 1, label: 'Tranquilo', bar: '▁' },
	{ value: 2, label: 'Bien', bar: '▂' },
	{ value: 3, label: 'Normal', bar: '▄' },
	{ value: 4, label: 'Cargado', bar: '▆' },
	{ value: 5, label: 'Muy cargado', bar: '█' },
] as const;

export type Tag = 'meeting' | 'bug' | 'deadline' | 'oncall' | 'review' | 'other';
export const tags: { value: Tag; label: string }[] = [
	{ value: 'meeting', label: 'Reuniones' },
	{ value: 'bug', label: 'Un bug' },
	{ value: 'deadline', label: 'Un plazo' },
	{ value: 'oncall', label: 'Guardia' },
	{ value: 'review', label: 'Revisión' },
	{ value: 'other', label: 'Otra cosa' },
];

export const sleepQuality = [
	{ value: 1, label: 'Muy mal' },
	{ value: 2, label: 'Mal' },
	{ value: 3, label: 'Regular' },
	{ value: 4, label: 'Bien' },
	{ value: 5, label: 'Muy bien' },
];
export const sleepHours = [
	{ value: 4.5, label: 'Menos de 5 h' },
	{ value: 5.5, label: '5–6 h' },
	{ value: 6.5, label: '6–7 h' },
	{ value: 7.5, label: '7–8 h' },
	{ value: 8.5, label: '8 h o más' },
];

/** Nombres amigables de las escalas (los oficiales incluyen palabras que el manual de marca evita). */
export const scaleNames: Record<string, string> = {
	PSS10: 'Estrés percibido (PSS-10)',
	WHO5: 'Bienestar (OMS-5)',
	PHQ9: 'Ánimo (PHQ-9)',
	GAD7: 'Preocupación (GAD-7)',
};

export const t = {
	nudge: '¿Cómo vas? Un toque y sigues con lo tuyo.',
	answer: 'Responder',
	notNow: 'Ahora no',
	question: '¿Cómo vas? Del 1 (tranquilo) al 5 (muy cargado)',
	tagPrompt: '¿Algo en particular? (opcional)',
	noTag: 'Sin etiqueta',
	thanks: 'Anotado. Gracias.',
	queued: 'Anotado. Lo enviamos cuando vuelva la conexión.',
	needsConsent: 'Anotado, pero falta activar el permiso de check-ins. Lo enviaremos cuando lo actives.',
	heavy: 'Anotado. Se nota cargado. ¿Te tomas dos minutos para ti?',
	offerPause: 'Una pausa breve',
	sleepQuestion: '¿Cómo dormiste anoche?',
	sleepHours: '¿Cuántas horas, más o menos? (opcional: Esc para omitir)',
	sleepSaved: 'Anotado. Lo tendremos en cuenta frente a tu ritmo habitual.',
	scaleNudge: (name: string) => `Hay una tanda corta de ${name}. ¿La respondes ahora?`,
	scaleItem: (name: string, n: number, total: number) => `${name} · Pregunta ${n} de ${total}`,
	scalePartDone: 'Listo por hoy. Guardamos tus respuestas y seguimos otro día.',
	scaleNone: 'No hay preguntas pendientes por hoy.',
	scaleResultNote: 'Es una referencia, no un diagnóstico. Si algo te preocupa, habla con un profesional.',
	later: 'Más tarde',
	noneAvailable: {
		DAILY_CAP_REACHED: 'Ya llegaste al tope de pausas sugeridas por hoy.',
		NO_CONTENT_AVAILABLE: 'Por ahora no hay ejercicios nuevos para ti.',
		NO_NEED: 'Por ahora no hay ejercicios nuevos para ti.',
		QUIET_HOURS: 'Estás en tus horas de silencio.',
	} as Record<string, string>,
	crisisTitle: 'No estás solo. Hablar con alguien ayuda.',
	crisisDetail: 'Estas líneas atienden gratis. Si estás en peligro inmediato, llama al 106 (SAMU) o al 105.',
	fallbackCrisis: 'Línea 113, opción 5 (MINSA): gratis, las 24 horas',
	unlinked: 'Vincula tu cuenta de Selyh para empezar.',
	link: 'Vincular cuenta',
	linkCode: (code: string) => `Tu código es ${code}. Apruébalo en la web de Selyh, que se abrió en tu navegador.`,
	linkWaiting: (code: string) => `Esperando que apruebes el código ${code}…`,
	linkDone: (name?: string) => (name ? `Listo, ${name}. Selyh ya está en tu editor.` : 'Listo. Selyh ya está en tu editor.'),
	linkDenied: 'Se rechazó la vinculación.',
	linkExpired: 'El código venció. Vuelve a intentarlo.',
	consentTitle: '¿Qué quieres compartir con Selyh? (puedes cambiarlo cuando quieras)',
	consentCheckin: 'Tu respuesta del 1 al 5 y, si quieres, una etiqueta. Es lo mínimo para que Selyh funcione.',
	consentSignals: 'Horas activas, minutos fuera de horario y racha continua más larga, calculadas aquí. Nunca código, archivos, teclas ni nombres de proyecto.',
	consentSleep: 'Cómo dormiste (1 a 5) y, si quieres, cuántas horas. Te lo preguntamos una vez al día, tras tu primer check-in.',
	pauseOffer: (title: string, min: number) => `¿Una pausa breve? ${title} · ${min} min`,
	pauseStart: 'Empezar',
	trend: { STABLE: 'Estable', RISING: 'En aumento', HIGH: 'Alta' } as Record<string, string>,
	calibrating: (days: number, required: number) => `${days} de ${required} días con datos. Mientras tanto no inventamos un número.`,
	signedOut: 'Se cerró tu sesión de Selyh.',
	paused: (until: string) => `Avisos pausados hasta las ${until}.`,
};
