import { useRef } from "react";

export default function useLatestValue<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}
