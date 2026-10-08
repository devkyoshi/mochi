import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// Slow machines running the whole suite in parallel can exceed the 1s default for findBy*/waitFor.
configure({ asyncUtilTimeout: 4000 });
