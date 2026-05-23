import { createElement } from 'react';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { ThemeBlueprint } from '@backstage/plugin-app-react';
import {
  UnifiedThemeProvider,
  createUnifiedTheme,
  genPageTheme,
  shapes,
} from '@backstage/theme';

// Handelsbanken brand palette (from handelsbanken.se CSS variables)
const HB = {
  navy: '#043b62',      // --SHB_HB6  sidebar
  blue: '#005fa5',      // --SHB_HB1  primary
  mid: '#017ab2',       // --SHB_HB5  links / hover
  sky: '#42b5d7',       // --SHB_HB4  accent / indicator
  skyLight: '#cbe3ef',  // --SHB_HB5--light
  offWhite: '#f3f2ef',  // --SHB_HB9--light  page background
  warm: '#eceae6',      // --SHB_HB9  dividers
  border: '#dedede',    // --SHB_GRAY--15
  text: '#1e1c15',      // H1 warm black
  textSub: '#636363',   // --SHB_GRAY--70
  textSubtle: '#a6a6a6',// --SHB_GRAY--40
  error: '#c83d2a',     // --SHB_HB10
  errorDark: '#932f21', // --SHB_HB10--contrast
  errorLight: '#f7e1de',// --SHB_HB10--light
  warning: '#e86f00',   // --SHB_HB19
  warningLight: '#fbe2cc',// --SHB_HB19--light
  success: '#007b45',   // --SHB_HB7--contrast
  white: '#ffffff',
};

const handelsbankTheme = createUnifiedTheme({
  fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  palette: {
    mode: 'light',
    type: 'light',
    primary:    { main: HB.blue,    light: HB.sky,      dark: HB.navy },
    secondary:  { main: HB.sky,     light: HB.skyLight, dark: HB.mid },
    error:      { main: HB.error },
    warning:    { main: HB.warning },
    info:       { main: HB.sky },
    success:    { main: HB.success },
    background: { default: HB.offWhite, paper: HB.white },
    text:       { primary: HB.text, secondary: HB.textSub },

    // Backstage palette additions
    status: {
      ok:      HB.success,
      warning: HB.warning,
      error:   HB.error,
      running: HB.blue,
      pending: '#ffed51',
      aborted: '#757575',
    },
    bursts: {
      fontColor: HB.white,
      slackChannelText: '#ddd',
      backgroundColor: { default: HB.navy },
      gradient: {
        linear: `linear-gradient(-137deg, ${HB.sky} 0%, ${HB.navy} 100%)`,
      },
    },
    banner: {
      info:             HB.blue,
      error:            HB.error,
      text:             HB.white,
      link:             HB.white,
      closeButtonColor: HB.white,
      warning:          HB.warning,
    },
    border:            HB.border,
    textContrast:      HB.text,
    textVerySubtle:    HB.border,
    textSubtle:        HB.textSub,
    highlight:         '#fffbcc',
    errorBackground:   HB.errorLight,
    warningBackground: HB.warningLight,
    infoBackground:    HB.skyLight,
    errorText:         HB.errorDark,
    infoText:          HB.navy,
    warningText:       '#000000',
    linkHover:         HB.mid,
    link:              HB.blue,
    gold:              '#FFD600',
    navigation: {
      background:    HB.navy,
      indicator:     HB.sky,
      color:         '#c4e2eb',
      selectedColor: HB.white,
      navItem:  { hoverBackground: HB.blue },
      submenu:  { background: HB.navy },
    },
    pinSidebarButton: { icon: HB.navy,  background: '#BDBDBD' },
    tabbar:           { indicator: HB.sky },
  },
  defaultPageTheme: 'home',
  pageTheme: {
    home:          genPageTheme({ colors: [HB.blue, HB.navy],  shape: shapes.wave }),
    documentation: genPageTheme({ colors: [HB.mid,  HB.blue],  shape: shapes.wave2 }),
    tool:          genPageTheme({ colors: [HB.navy, HB.blue],  shape: shapes.round }),
    service:       genPageTheme({ colors: [HB.blue, HB.navy],  shape: shapes.wave }),
    website:       genPageTheme({ colors: [HB.sky,  HB.mid],   shape: shapes.wave }),
    library:       genPageTheme({ colors: [HB.blue, HB.navy],  shape: shapes.wave2 }),
    other:         genPageTheme({ colors: [HB.navy, HB.blue],  shape: shapes.round }),
    app:           genPageTheme({ colors: [HB.blue, HB.navy],  shape: shapes.wave }),
    apis:          genPageTheme({ colors: [HB.mid,  HB.navy],  shape: shapes.wave }),
  },
});

export const themeModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    ThemeBlueprint.make({
      name: 'handelsbanken',
      params: {
        theme: {
          id: 'handelsbanken-light',
          title: 'Handelsbanken',
          variant: 'light',
          icon: createElement('span', null, '🏦'),
          Provider: ({ children }) =>
            createElement(UnifiedThemeProvider, { theme: handelsbankTheme, children }),
        },
      },
    }),
  ],
});
