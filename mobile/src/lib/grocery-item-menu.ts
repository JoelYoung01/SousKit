import type { GroceryItem } from "@/types";
import { ActionSheetIOS, Platform } from "react-native";

export type GroceryItemMenuAction = "edit" | "view-recipe" | "dismiss" | "delete";

export function buildGroceryItemMenuOptions(item: GroceryItem) {
  const options: string[] = ["Edit"];
  const actions: (GroceryItemMenuAction | "cancel")[] = ["edit"];

  if (item.recipes.length > 0) {
    options.push("View Recipe");
    actions.push("view-recipe");
  }

  options.push("Dismiss", "Delete", "Cancel");
  actions.push("dismiss", "delete", "cancel");

  return {
    options,
    actions,
    cancelButtonIndex: options.length - 1,
    destructiveButtonIndex: options.indexOf("Delete")
  };
}

export function showGroceryItemContextMenu(
  item: GroceryItem,
  onSelect: (action: GroceryItemMenuAction) => void
) {
  if (Platform.OS !== "ios") return;

  const { options, actions, cancelButtonIndex, destructiveButtonIndex } =
    buildGroceryItemMenuOptions(item);

  ActionSheetIOS.showActionSheetWithOptions(
    {
      options,
      cancelButtonIndex,
      destructiveButtonIndex
    },
    (buttonIndex) => {
      if (buttonIndex < 0) return;
      const action = actions[buttonIndex];
      if (action === "cancel") return;
      onSelect(action);
    }
  );
}
