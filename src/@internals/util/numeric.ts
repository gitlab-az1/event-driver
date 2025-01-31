export const numericBounds = Object.freeze([
  '0'.charCodeAt(0),
  '9'.charCodeAt(0),
]);


export function isDecimalTextRepresentation(text: string): boolean {
  if(text.length < 3)
    return false; // Minimum length: "0.0"

  let i = 0;
  let char = text.charAt(0);

  if(char === '+' || char === '-') {
    if(text.length < 4)
      return false; // "+0.0" is the shortest valid case
    
    i++;
  }

  let dotSeen = false;
  let hasDigitBeforeDot = false;
  let hasDigitAfterDot = false;

  for(; i < text.length; i++) {
    char = text.charAt(i);

    if(char === '.') {
      if(dotSeen || i === 0 || i === text.length - 1)
        return false; // No multiple dots, and it can't be at start/end

      dotSeen = true;
      continue;
    }

    if(char >= '0' && char <= '9') {
      if(!dotSeen) {
        hasDigitBeforeDot = true;
      } else {
        hasDigitAfterDot = true;
      }
    } else {
      return false;
    }
  }

  return dotSeen && hasDigitBeforeDot && hasDigitAfterDot;
}

export function isIntegerTextRepresentation(text: string): boolean {
  if(text.length < 1)
    return false;

  let i = 0;
  let char = text.charAt(0);

  if(char === '+' || char === '-') {
    if(text.length === 1)
      return false;

    i++;
  }

  for(; i < text.length; i++) {
    char = text.charAt(i);

    if(char < '0' || char > '9')
      return false;
  }

  return true;
}
