/**
 * App-wide keyboard primitives from react-native-keyboard-controller,
 * with NativeWind className support wired via cssInterop.
 *
 * Prefer these over React Native's KeyboardAvoidingView:
 * - KeyboardAwareScrollView — form screens (scrolls focused input into view)
 * - KeyboardStickyView — bottom sheets / sticky footers that must sit above the keyboard
 */
import { cssInterop } from "nativewind";
import {
  KeyboardAwareScrollView as KeyboardAwareScrollViewBase,
  KeyboardStickyView as KeyboardStickyViewBase
} from "react-native-keyboard-controller";

cssInterop(KeyboardAwareScrollViewBase, {
  className: "style",
  contentContainerClassName: "contentContainerStyle"
});

cssInterop(KeyboardStickyViewBase, {
  className: "style"
});

export const KeyboardAwareScrollView = KeyboardAwareScrollViewBase;
export const KeyboardStickyView = KeyboardStickyViewBase;
export { KeyboardProvider } from "react-native-keyboard-controller";
