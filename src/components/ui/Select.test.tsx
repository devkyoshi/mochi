import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

const OPTIONS = [
  { value: "a", label: "alpha", hint: "first" },
  { value: "b", label: "beta" },
  { value: "c", label: "gamma" },
];

function setup(value = "a") {
  const onChange = vi.fn();
  render(<Select label="Pick" value={value} options={OPTIONS} onChange={onChange} />);
  return { onChange, button: screen.getByRole("button", { name: "Pick" }) };
}

describe("Select", () => {
  it("shows the chosen label and opens a listbox on click", () => {
    const { button } = setup("b");
    expect(button).toHaveTextContent("beta");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: /beta/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("selects with the mouse and closes", () => {
    const { button, onChange } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("option", { name: /gamma/ }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports the keyboard: arrows, Enter, Home/End, type-ahead", () => {
    const { button, onChange } = setup();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("b");

    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "End" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: " " });
    expect(onChange).toHaveBeenLastCalledWith("c");

    fireEvent.keyDown(button, { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "b" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("Escape closes only the list and does not reach the window", () => {
    const { button, onChange } = setup();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    window.removeEventListener("keydown", outer);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(outer).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on an outside click and shows a placeholder when nothing is chosen", () => {
    const onChange = vi.fn();
    render(<Select label="Pick" value="" options={OPTIONS} onChange={onChange} placeholder="Choose one" />);
    const button = screen.getByRole("button", { name: "Pick" });
    expect(button).toHaveTextContent("Choose one");
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("explains an empty list", () => {
    render(<Select label="Pick" value="" options={[]} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByText("Nothing to choose yet.")).toBeInTheDocument();
  });
});
