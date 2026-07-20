export interface TwoFingerGestureState { active: boolean; start: number; moved: boolean; undone: boolean; }

export function shouldUndoTwoFingerTap(gesture: TwoFingerGestureState, finishedAt: number) {
  return gesture.active && !gesture.undone && !gesture.moved && finishedAt - gesture.start >= 0 && finishedAt - gesture.start < 450;
}
