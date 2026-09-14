import type { DiceResult } from '../../types/models';
import { translate } from '../i18n';

// ============================================================
// roll_dice — 与 App 的 DiceRoller 一致
// ============================================================

const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/;

export function rollDice(expression: string): string {
  const expr = expression.trim() || '1d20';
  const m = expr.match(DICE_RE);
  if (!m) return translate('tool.diceExprInvalid', { expr: expression });

  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;

  if (count < 1 || count > 100) return translate('tool.diceCountRange');
  if (sides < 2 || sides > 10000) return translate('tool.diceSidesRange');
  if (Math.abs(modifier) > 1000000) return translate('tool.diceModTooBig');

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(1 + Math.floor(Math.random() * sides));
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;

  let critical = '';
  if (count === 1 && sides === 20) {
    if (rolls[0] === 20) critical = translate('tool.diceCrit20');
    else if (rolls[0] === 1) critical = translate('tool.diceCrit1');
  }

  const parts = [rolls.join(', ')];
  if (modifier !== 0) parts.push(`${modifier > 0 ? '+' : ''}${modifier}`);
  return translate('tool.diceRoll', { expr, rolls: parts.join('] '), total, crit: critical });
}

export function rollDiceStructured(expression: string): DiceResult | null {
  const m = expression.trim().match(DICE_RE);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (count < 1 || count > 100 || sides < 2 || sides > 10000) return null;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  let critical: DiceResult['critical'];
  if (count === 1 && sides === 20) {
    critical = rolls[0] === 20 ? 'success' : rolls[0] === 1 ? 'failure' : undefined;
  }
  return { expression: expression.trim(), rolls, modifier, total, critical };
}