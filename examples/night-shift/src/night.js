// Dead of night (Req 3.1): from 00:00 up to but not including 06:00, on the guest's local hour.
export function isDeadOfNight({ hour }) {
  return hour >= 0 && hour < 6;
}
