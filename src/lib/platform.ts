export const IS_ANDROID = /Android/i.test(navigator.userAgent);
export const IS_ANDROID_TV =
  IS_ANDROID && window.matchMedia("(hover: none) and (pointer: none)").matches;

document.documentElement.classList.toggle("android", IS_ANDROID);
document.documentElement.classList.toggle("android-tv", IS_ANDROID_TV);
