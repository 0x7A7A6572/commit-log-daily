import { Box, Text } from "ink";
import { useState, useRef, useEffect } from "react";

export function LoadingView({
  loadingText,
  color,
  loading,
}: {
  loadingText?: string;
  color?: string;
  loading?: boolean;
}) {
  const loadChat = ['/', '-', '\\', '|'];
  const isLoading = useRef<boolean>(loading || false);
  const [iconIndex, setIconIndex] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isLoading.current) {
        setIconIndex((prev) => (prev + 1) % loadChat.length);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [loadChat.length]);

  const loadingIcon = loadChat[iconIndex]!;

  return (
    <Box>
      <Text color={color || "yellow"}> {loadingIcon} </Text>
      <Text color={color || "yellow"}>{loadingText || "Loading..."}</Text>
    </Box>
  );
}
