// ============================================================
// App icon registry — powered by ng-icons (https://ng-icons.github.io).
// Registered once at the app root via provideIcons(). Keys MUST be the
// lowerCamelCase form of the name used in templates, because ng-icons
// resolves <ng-icon name="foo-bar"> through toPropertyName() → "fooBar"
// before looking the icon up. tp-icon passes its kebab `name` straight
// through, so e.g. name="check-square" resolves to the "checkSquare" key.
//
// SVGs come from the Feather pack (@ng-icons/feather-icons); Lucide
// (@ng-icons/lucide) supplies `sparkles`, the one glyph Feather lacks.
// ============================================================
import {
  featherGrid, featherCheckSquare, featherCalendar, featherFolder, featherCpu,
  featherBarChart2, featherMenu, featherSearch, featherPlus, featherX, featherCheck,
  featherLogIn, featherUserPlus, featherEdit2, featherTrash2, featherAlertCircle,
  featherClock, featherFlag, featherTag, featherLayers, featherZap, featherTrendingUp,
  featherUsers, featherSend, featherMic, featherImage, featherArrowRight, featherArrowLeft,
  featherChevronDown, featherChevronUp, featherChevronRight, featherMoreHorizontal,
  featherFilter, featherRepeat, featherLogOut, featherSun, featherMoon, featherSettings,
  featherInbox, featherList, featherPlayCircle, featherCircle, featherFileText,
  featherUpload, featherLink, featherCopy, featherMessageSquare, featherMessageCircle,
  featherBold, featherItalic, featherType, featherCheckCircle, featherCornerDownLeft,
  featherAtSign, featherUser, featherSquare, featherRotateCcw, featherRotateCw,
  featherStar, featherBookmark,
} from '@ng-icons/feather-icons';
import { lucideSparkles } from '@ng-icons/lucide';

/** camelCase key (== toPropertyName of the template name) → icon SVG. */
export const APP_ICONS: Record<string, string> = {
  grid:            featherGrid,
  checkSquare:     featherCheckSquare,
  calendar:        featherCalendar,
  folder:          featherFolder,
  cpu:             featherCpu,
  barChart2:       featherBarChart2,
  menu:            featherMenu,
  search:          featherSearch,
  plus:            featherPlus,
  x:               featherX,
  check:           featherCheck,
  logIn:           featherLogIn,
  userPlus:        featherUserPlus,
  edit2:           featherEdit2,
  trash2:          featherTrash2,
  alertCircle:     featherAlertCircle,
  clock:           featherClock,
  flag:            featherFlag,
  tag:             featherTag,
  layers:          featherLayers,
  zap:             featherZap,
  trendingUp:      featherTrendingUp,
  users:           featherUsers,
  send:            featherSend,
  mic:             featherMic,
  image:           featherImage,
  arrowRight:      featherArrowRight,
  arrowLeft:       featherArrowLeft,
  chevronDown:     featherChevronDown,
  chevronUp:       featherChevronUp,
  chevronRight:    featherChevronRight,
  moreHorizontal:  featherMoreHorizontal,
  filter:          featherFilter,
  repeat:          featherRepeat,
  logOut:          featherLogOut,
  sun:             featherSun,
  moon:            featherMoon,
  settings:        featherSettings,
  inbox:           featherInbox,
  sparkles:        lucideSparkles,
  list:            featherList,
  playCircle:      featherPlayCircle,
  circle:          featherCircle,
  fileText:        featherFileText,
  upload:          featherUpload,
  link:            featherLink,
  copy:            featherCopy,
  messageSquare:   featherMessageSquare,
  messageCircle:   featherMessageCircle,
  bold:            featherBold,
  italic:          featherItalic,
  type:            featherType,
  checkCircle:     featherCheckCircle,
  cornerDownLeft:  featherCornerDownLeft,
  atSign:          featherAtSign,
  user:            featherUser,
  square:          featherSquare,
  rotateCcw:       featherRotateCcw,
  rotateCw:        featherRotateCw,
  star:            featherStar,
  bookmark:        featherBookmark,
};
