import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type TagPopoverOption = {
  description?: string;
  displayLabel?: string;
  group: string;
  id: string;
  label: string;
};

type TagPopoverSelectProps = {
  addLabel: string;
  emptyLabel: string;
  label: string;
  onChange: (value: string[]) => void;
  options: TagPopoverOption[];
  placeholder: string;
  removeLabel: (label: string) => string;
  value: string[];
};

export function TagPopoverSelect({
  addLabel,
  emptyLabel,
  label,
  onChange,
  options,
  placeholder,
  removeLabel,
  value,
}: TagPopoverSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionMap = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options],
  );
  const selectedOptions = value
    .map((optionId) => optionMap.get(optionId))
    .filter((option): option is TagPopoverOption => Boolean(option));
  const groupedOptions = useMemo(() => {
    return options.reduce<Array<{ group: string; options: TagPopoverOption[] }>>(
      (groups, option) => {
        const group = groups.find((item) => item.group === option.group);
        if (group) {
          group.options.push(option);
          return groups;
        }

        return [...groups, { group: option.group, options: [option] }];
      },
      [],
    );
  }, [options]);
  const [activeGroup, setActiveGroup] = useState("");
  const currentGroup =
    groupedOptions.find((group) => group.group === activeGroup) ??
    groupedOptions[0] ?? { group: "", options: [] };

  useEffect(() => {
    if (groupedOptions.length === 0) {
      setActiveGroup("");
      return;
    }

    if (!groupedOptions.some((group) => group.group === activeGroup)) {
      setActiveGroup(groupedOptions[0].group);
    }
  }, [activeGroup, groupedOptions]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const commitValue = (nextValue: string[]) => {
    if (nextValue.length > 0) {
      onChange(nextValue);
    }
  };

  const toggleOption = (optionId: string) => {
    commitValue(
      value.includes(optionId)
        ? value.filter((item) => item !== optionId)
        : [...value, optionId],
    );
  };

  const removeOption = (optionId: string) => {
    commitValue(value.filter((item) => item !== optionId));
  };

  return (
    <div className="tag-popover-field" ref={rootRef}>
      <span className="tag-popover-label">{label}</span>
      <div
        className={`tag-popover-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <span className="selected-model-tags">
          {selectedOptions.length > 0 ? (
            selectedOptions.map((option) => (
              <span key={option.id} className="model-tag">
                <span className="model-tag-provider">{option.group}</span>
                <code className="model-tag-name" title={option.label}>
                  {option.displayLabel ?? option.label}
                </code>
                <button
                  type="button"
                  className="model-tag-remove"
                  aria-label={removeLabel(option.label)}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeOption(option.id);
                  }}
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </span>
            ))
          ) : (
            <span className="tag-popover-placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown aria-hidden="true" size={15} />
      </div>
      {open ? (
        <div className="tag-popover-menu" role="listbox" aria-label={label}>
          <div className="tag-popover-menu-title">{addLabel}</div>
          {options.length > 0 ? (
            <div className="tag-popover-cascade">
              <div className="tag-popover-provider-list">
                {groupedOptions.map((group) => {
                  const selectedCount = group.options.filter((option) =>
                    value.includes(option.id),
                  ).length;

                  return (
                    <button
                      type="button"
                      key={group.group}
                      className={`tag-popover-provider-option ${currentGroup.group === group.group ? "active" : ""}`}
                      onClick={() => setActiveGroup(group.group)}
                      onMouseEnter={() => setActiveGroup(group.group)}
                    >
                      <span>{group.group}</span>
                      {selectedCount > 0 ? <small>{selectedCount}</small> : null}
                      <ChevronDown aria-hidden="true" size={12} />
                    </button>
                  );
                })}
              </div>
              <div className="tag-popover-options">
                {currentGroup.options.map((option) => {
                  const selected = value.includes(option.id);

                  return (
                    <button
                      type="button"
                      key={option.id}
                      className={`tag-popover-option ${selected ? "selected" : ""}`}
                      onClick={() => toggleOption(option.id)}
                      role="option"
                      aria-selected={selected}
                    >
                      <span className="tag-popover-option-body">
                        <strong title={option.label}>
                          {option.displayLabel ?? option.label}
                        </strong>
                        {option.description ? <small>{option.description}</small> : null}
                      </span>
                      <span className="tag-popover-check">
                        {selected ? <Check aria-hidden="true" size={13} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="tag-popover-empty">{emptyLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
