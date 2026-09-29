// Testing Library's matchers (toHaveTextContent, toBeDisabled, …) register on
// import in v13, for every client test, including those that import nothing else from it.
import "@testing-library/react-native";
