/**
 * @gorhom/bottom-sheet for client tests: the library's own jest mock, but with
 * a real View for BottomSheetView so a non-scrolling sheet keeps its props.
 * `jest.mock("@gorhom/bottom-sheet", () => require("../helpers/mocks/bottom-sheet"))`.
 */
import { View } from "react-native";

// The library ships its mock as untyped CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const library = require("@gorhom/bottom-sheet/mock");

module.exports = { __esModule: true, ...library, BottomSheetView: View };
