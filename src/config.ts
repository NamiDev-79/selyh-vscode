import * as vscode from 'vscode';

import type { WorkHours } from './activity';

const cfg = () => vscode.workspace.getConfiguration('selyh');
const trim = (s: string) => s.trim().replace(/\/+$/, '');

export const apiUrl = () => trim(cfg().get('apiUrl', 'https://selyhbackend-production.up.railway.app'));
export const webUrl = () => trim(cfg().get('webUrl', 'https://selyh.fun'));
export const workHours = (): WorkHours => ({
	start: cfg().get('workHours.start', '09:00'),
	end: cfg().get('workHours.end', '18:00'),
	weekends: cfg().get('workHours.weekends', false),
});
