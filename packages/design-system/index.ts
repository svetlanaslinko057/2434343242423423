/**
 * Design System — public surface.
 *
 * Import from this file in app code. Do NOT reach into subfolders unless
 * you're inside the package itself.
 */

export { palette, getPalette, type ThemeName, type Palette } from './tokens/palette';
export * as spacing from './tokens/spacing';
export * as typo from './typography/index';
export * as motion from './motion/index';

export {
  ThemeEngine,
  STORAGE_KEY,
  type ThemeStorage,
  type ThemeApply,
  type ThemeEngineConfig,
} from './theme/ThemeEngine';

/* Adapters are NOT re-exported here — pick the right adapter per
   platform at the consumer site:
     web:    import { webStorage, webApply } from '@design-system/theme/adapter.web';
     native: import { nativeStorage, nativeApply } from '@design-system/theme/adapter.native';
*/
