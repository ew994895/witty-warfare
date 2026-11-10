import {DIFFICULTIES,GAME_RULES,roomSettings} from './rules.js?v=11';

const skillLabels = {
  default: 'Use room difficulty',
  practice: 'Aim practice',
  easy: 'Warm-up',
  normal: 'Regular',
  hard: 'Sweaty',
  mixed: 'Random skill'
};
const names = ['Moss', 'Brick', 'Glitch', 'Dune', 'Echo', 'Flint', 'Nova'];
const choices = values => values.map(value => [value, value]);

export function createRoomControls(container) {
  const fields = {};
  const labels = {};
  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  container.append(grid);

  function field(key, title, options, parent = grid) {
    const label = document.createElement('label');
    label.append(title);
    const select = document.createElement('select');
    select.name = key;
    for (const [value, text] of options) select.add(new Option(text, value));
    label.append(select);
    parent.append(label);
    fields[key] = select;
    labels[key] = label;
  }

  field('rules', 'Game rules', Object.entries(GAME_RULES));
  field('maxPlayers', 'Total slots', choices([2, 3, 4, 5, 6, 7, 8]));
  field('botCount', 'Bots', [[-1, 'Fill open slots'], ...choices([0, 1, 2, 3, 4, 5, 6, 7])]);
  field('difficulty', 'Bot difficulty', DIFFICULTIES.map(skill => [skill, skillLabels[skill]]));
  field('duration', 'Round length', [[120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes']]);
  field('scoreLimit', 'Kills to win', [[0, 'Time limit only'], ...choices([10, 20, 30, 40, 50])]);
  field('teamSetup', 'Team setup', [['mixed', 'Mixed teams'], ['humans-vs-bots', 'Humans vs bots']]);
  field('friendlyFire', 'Friendly fire', [[0, 'Off'], [1, 'On']]);
  field('respawnTime', 'Respawn delay', [[1.25, '1.25 seconds'], [2.5, '2.5 seconds'], [4, '4 seconds']]);

  const botDetails = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Individual bot skills';
  const botGrid = document.createElement('div');
  botGrid.className = 'settings-grid';
  botDetails.append(summary, botGrid);
  container.append(botDetails);
  names.forEach((name, i) => field('bot' + i, name,
    ['default', ...DIFFICULTIES].map(skill => [skill, skillLabels[skill]]), botGrid));

  function read() {
    const value = key => fields[key].value;
    return roomSettings({
      rules: value('rules'),
      maxPlayers: +value('maxPlayers'),
      botCount: +value('botCount'),
      difficulty: value('difficulty'),
      duration: +value('duration'),
      scoreLimit: +value('scoreLimit'),
      teamSetup: value('teamSetup'),
      friendlyFire: value('friendlyFire') === '1',
      respawnTime: +value('respawnTime'),
      botSkills: names.map((_, i) => value('bot' + i))
    });
  }

  function write(settings) {
    const tdm = settings.rules === 'tdm';
    const maxBots = settings.teamSetup === 'humans-vs-bots' ? settings.maxPlayers / 2 : settings.maxPlayers - 1;
    for (const option of fields.maxPlayers.options) option.disabled = tdm && +option.value % 2 !== 0;
    for (const option of fields.botCount.options) option.disabled = +option.value > maxBots;
    for (const key of ['teamSetup', 'friendlyFire']) labels[key].hidden = !tdm;
    labels.scoreLimit.hidden=settings.rules==='gun'||settings.rules==='storm';
    for (const key of ['rules', 'maxPlayers', 'botCount', 'difficulty', 'duration', 'scoreLimit', 'teamSetup', 'respawnTime']) {
      fields[key].value = settings[key];
    }
    fields.friendlyFire.value = Number(settings.friendlyFire);
    const visibleBots = settings.botCount === -1 ? maxBots : settings.botCount;
    botDetails.hidden = visibleBots === 0;
    names.forEach((_, i) => {
      fields['bot' + i].value = settings.botSkills[i];
      labels['bot' + i].hidden = i >= visibleBots;
    });
  }

  fields.rules.addEventListener('change', () => {
    fields.scoreLimit.value = fields.rules.value === 'tdm' ? 30 : 0;
  });
  container.addEventListener('change', () => write(read()));
  write(roomSettings());
  return {read, write};
}
