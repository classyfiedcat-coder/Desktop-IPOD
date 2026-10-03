/** Extras menu: Alarms, Calendar, Clocks, Games, Notes, Screen Lock, Stopwatch. */

import { ListView } from '../list.js';
import { clocksMenu } from './clock.js';
import { alarmsMenu, AlarmClock, SleepTimer } from './alarms.js';
import { StopwatchView, screenLockMenu, notesMenu } from './tools.js';
import { gamesMenu } from './games.js';
import { createPim } from './pim.js';

export function createExtras(app) {
  app.alarmClock = new AlarmClock(app);
  app.sleepTimer = new SleepTimer(app);
  const pim = createPim(app);
  return {
    menu() {
      return new ListView({
        title: 'Extras',
        split: true,
        items: [
          { label: 'Alarms', view: () => alarmsMenu(app) },
          { label: 'Calendars', view: () => pim.calendars() },
          { label: 'Clocks', view: () => clocksMenu(app) },
          { label: 'Contacts', view: () => pim.contacts() },
          { label: 'Games', view: () => gamesMenu(app) },
          { label: 'Notes', view: () => notesMenu(app) },
          { label: 'Screen Lock', view: () => screenLockMenu(app) },
          { label: 'Stopwatch', view: () => new StopwatchView() },
        ],
      });
    },
    games: () => gamesMenu(app),
    clock: () => clocksMenu(app),
    alarms: () => alarmsMenu(app),
  };
}
