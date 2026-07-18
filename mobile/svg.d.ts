declare module '*.svg' {
    import React from 'react';
    import { SvgProps } from 'react-native-svg';
    const content: React.FC<SvgProps>;
    export default content;
}

declare module '*.sql' {
    const value: number; // Metro resolves non-JS assets to a numeric module ID,
    // same as it does for images — not string file content.
    // Asset.fromModule() turns that ID into something
    // readable (via downloadAsync + localUri), which is
    // exactly what initSchema() already does with it.
    export default value;
}