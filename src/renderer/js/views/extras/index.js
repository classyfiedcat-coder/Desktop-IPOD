/** Extras menu: Alarms, Calendar, Clocks, Games, Notes, Screen Lock, Stopwatch. */

import { ListView } from '../list.js';
import { clocksMenu } from './clock.js';
import { alarmsMenu, AlarmClock, SleepTimer } from './alarms.js';
import { StopwatchView, screenLockMenu, CalendarView, notesMenu } from './tools.js';
import { gamesMenu } from './games.js';

export function createExtras(app) {
  app.alarmClock = new AlarmClock(app);
  app.sleepTimer = new SleepTimer(app);
  return {
    menu() {
      return new ListView({
        title: 'Extras',
        items: [
          { label: 'Alarms', view: () => alarmsMenu(app) },
          { label: 'Calendar', view: () => new CalendarView() },
          { label: 'Clocks', view: () => clocksMenu(app) },
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
