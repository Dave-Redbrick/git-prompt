export const pauseOtherAudioInGroup = (currentAudio: HTMLAudioElement) => {
  const group = currentAudio.dataset.audioGroup;

  if (!group) {
    return;
  }

  document
    .querySelectorAll<HTMLAudioElement>("audio[data-audio-group]")
    .forEach((audio) => {
      if (audio !== currentAudio && audio.dataset.audioGroup === group) {
        audio.pause();
      }
    });
};
