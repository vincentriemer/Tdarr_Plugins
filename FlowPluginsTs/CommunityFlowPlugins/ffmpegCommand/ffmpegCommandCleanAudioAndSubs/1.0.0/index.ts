/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable import/prefer-default-export */

import {
  IffmpegCommandStream,
  IpluginDetails,
  IpluginInputArgs,
  IpluginOutputArgs,
} from '../../../../FlowHelpers/1.0.0/interfaces/interfaces';
import { Istreams } from '../../../../FlowHelpers/1.0.0/interfaces/synced/IFileObject';

// eslint-disable-next-line no-shadow
enum FOREIGN_STRATEGY {
  SUBS = 'subs',
  DUBS = 'dubs',
}

const STREAM_TYPE_MULTIPLIER = 10000;
const STREAM_LANGUAGE_MULTIPLIER = 1000;
const STREAM_FORCED_SUBTITLE_MULTIPLIER = 10;
const STREAM_SDH_SUBTITLE_MULTIPLIER = 20;

export const details = (): IpluginDetails => ({
  name: 'Clean Audio and Subtitle Streams',
  description:
    "Cleans the audio and subtitle streams, removing any streams that aren't in the original language or are specified",
  style: {
    borderColor: '#6efefc',
  },
  isStartPlugin: false,
  pType: '',
  tags: 'video',
  requiresVersion: '2.11.01',
  sidebarPosition: -1,
  icon: '',
  inputs: [
    {
      name: 'api_key',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Input your TMDB api (v3) key here. (https://www.themoviedb.org/)',
    },
    {
      name: 'primary_language',
      type: 'string',
      defaultValue: 'en',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Specify the primary language you understand/want to consume.',
    },
    {
      name: 'additional_languages',
      type: 'string',
      defaultValue: '',
      inputUI: {
        type: 'text',
      },
      tooltip: 'Optionally specify the additional language tags to always keep, separated by commas.',
    },
    {
      name: 'foreign_strategy',
      type: 'string',
      defaultValue: FOREIGN_STRATEGY.SUBS,
      inputUI: {
        type: 'dropdown',
        options: [
          FOREIGN_STRATEGY.SUBS,
          FOREIGN_STRATEGY.DUBS,
        ],
      },
      tooltip: 'Specify the strategy how to handle foreign movies.',
    },
    {
      name: 'remove_commentary_tracks',
      type: 'boolean',
      defaultValue: 'true',
      inputUI: {
        type: 'dropdown',
        options: [
          'true',
          'false',
        ],
      },
      tooltip: 'Remove commentary, description, and SDH streams',
    },
    {
      name: 'include_native_subs',
      type: 'boolean',
      defaultValue: 'false',
      inputUI: {
        type: 'dropdown',
        options: [
          'true',
          'false',
        ],
      },
      tooltip: "Option to include the movie's native/original language subtitles.",
    },
  ],
  outputs: [
    {
      number: 1,
      tooltip: 'Continue to next plugin',
    },
  ],
});

const performInitialSorting = (streams: IffmpegCommandStream[]) => {
  const languages = '';
  const codecs = 'truehd,dts,eac3,ac3,aac';
  const channels = '7.1,5.1,2,1';
  const streamTypes = '';

  const sortStreams = (sortType: {
    inputs: string,
    getValue: (stream: Istreams) => string,
  }) => {
    const items = sortType.inputs.split(',');
    items.reverse();
    for (let i = 0; i < items.length; i += 1) {
      const matchedStreams = [];
      for (let j = 0; j < streams.length; j += 1) {
        if (String(sortType.getValue(streams[j])) === String(items[i])) {
          if (
            streams[j].codec_long_name
            && (
              streams[j].codec_long_name.includes('image')
              || streams[j].codec_name.includes('png')
            )
          ) {
            // do nothing, ffmpeg bug, doesn't move image streams
          } else {
            matchedStreams.push(streams[j]);
            streams.splice(j, 1);
            j -= 1;
          }
        }
      }
      streams = matchedStreams.concat(streams);
    }
  };

  const sortTypes:{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any,
  } = {
    languages: {
      getValue: (stream: Istreams) => {
        if (stream?.tags?.language) {
          return stream.tags.language;
        }

        return '';
      },
      inputs: languages,
    },
    codecs: {
      getValue: (stream: Istreams) => {
        try {
          return stream.codec_name;
        } catch (err) {
          // err
        }
        return '';
      },
      inputs: codecs,
    },
    channels: {
      getValue: (stream: Istreams) => {
        const chanMap:{
          [key: number]: string
        } = {
          8: '7.1',
          6: '5.1',
          2: '2',
          1: '1',
        };

        if (stream?.channels && chanMap[stream.channels]) {
          return chanMap[stream.channels];
        }

        return '';
      },
      inputs: channels,
    },
    streamTypes: {
      getValue: (stream:Istreams) => {
        if (stream.codec_type) {
          return stream.codec_type;
        }
        return '';
      },
      inputs: streamTypes,
    },
  };

  const processOrderArr = ['codecs', 'channels'];
  for (let k = 0; k < processOrderArr.length; k += 1) {
    if (sortTypes[processOrderArr[k]] && sortTypes[processOrderArr[k]].inputs) {
      sortStreams(sortTypes[processOrderArr[k]]);
    }
  }
};

const TITLE_AND_YEAR_REGEX = /^(.+) \((\d+)\)$/;

const streamsContainLanguage = (
  streams: IffmpegCommandStream[],
  codec_type: 'audio' | 'subtitle',
  language: string,
): boolean => {
  // eslint-disable-next-line import/no-unresolved
  const isoLanguages = require('@cospired/i18n-iso-languages');

  // eslint-disable-next-line no-restricted-syntax
  for (const stream of streams) {
    if (stream.codec_type === codec_type && stream.tags?.language === isoLanguages.alpha2ToAlpha3B(language)) {
      return true;
    }
  }

  return false;
};

const getSortValueFromStream = (
  stream: IffmpegCommandStream,
  streamTypeOrder: string[],
  audioLangOrder: string[],
  subtitleLangOrder: string[],
): number => {
  let sortValue = 0;

  // handle stream type
  let streamIndex = streamTypeOrder.indexOf(stream.codec_type);
  streamIndex = streamIndex === -1 ? streamTypeOrder.length + 1 : streamIndex;
  sortValue += streamIndex * STREAM_TYPE_MULTIPLIER;

  // handle language
  const streamLanguage = stream.tags?.language;
  if (streamLanguage && (stream.codec_type === 'audio' || stream.codec_type === 'subtitle')) {
    const unspecifiedLangIndex = Math.max(audioLangOrder.length, subtitleLangOrder.length) + 1;

    let langIndex = stream.codec_type === 'audio'
      ? audioLangOrder.indexOf(streamLanguage)
      : subtitleLangOrder.indexOf(streamLanguage);
    langIndex = langIndex === -1 ? unspecifiedLangIndex : langIndex;

    sortValue += langIndex * STREAM_LANGUAGE_MULTIPLIER;
  }

  // handle forced subtitles (should be deproritized)
  if (stream.disposition?.forced) {
    sortValue += STREAM_FORCED_SUBTITLE_MULTIPLIER;
  }

  // handle sdh subtitkles (should be deproritized)
  if (stream.tags?.title?.toLowerCase().includes('sdh')) {
    sortValue += STREAM_SDH_SUBTITLE_MULTIPLIER;
  }

  return sortValue;
};

export const plugin = async (args: IpluginInputArgs): Promise<IpluginOutputArgs> => {
  await args.installClassicPluginDeps(['@cospired/i18n-iso-languages']);

  const lib = require('../../../../../methods/lib')();
  // eslint-disable-next-line no-param-reassign
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  const {
    api_key,
    remove_commentary_tracks,
    foreign_strategy,
  } = args.inputs;

  const primary_language = String(args.inputs.primary_language);
  const additional_languages = String(args.inputs.additional_languages);
  const include_native_subs = !!args.inputs.include_native_subs;

  // Extract the movie name & year from the filename
  let filename = args.inputFileObj.meta?.FileName ?? args.inputFileObj.file ?? '';
  filename = filename.replace(/\.[^/.]+$/, ''); // Remove file extension
  const regexResult = TITLE_AND_YEAR_REGEX.exec(filename);
  if (regexResult == null || regexResult.length !== 3) {
    const message = `Failed to parse movie name and year from filename: ${filename}`;
    args.jobLog(message);
    throw new Error(message);
  }
  const movieName = regexResult[1];
  const movieYear = regexResult[2];

  // Search for the TMDB result for the movie
  const { axios } = args.deps;
  const encodedMovieName = encodeURIComponent(movieName);
  const tmdbResult = await axios.get(
    `https://api.themoviedb.org/3/search/movie?api_key=${api_key}`
    + `&query=${encodedMovieName}&year=${movieYear}`,
  ).then((resp: any) => (resp.data.results.length > 0 ? resp.data.results[0] : null));
  if (!tmdbResult) {
    const message = `Failed to find movie on TMDB: ${movieName} (${movieYear})`;
    args.jobLog(message);
    throw new Error(message);
  }

  const streams: IffmpegCommandStream[] = JSON.parse(JSON.stringify(args.variables.ffmpegCommand.streams));
  const originalStreams = JSON.stringify(streams);

  // Perform initial sorting
  performInitialSorting(streams);

  // If the original language is pulled as Chinese 'cn' is used.  iso-language expects 'zh' for Chinese.
  const originalLanguage: string | null = tmdbResult.original_language === 'cn' ? 'zh' : tmdbResult.original_language;

  const hasPrimaryAudio = streamsContainLanguage(streams, 'audio', primary_language);

  const audioLanguagesToKeep = new Set();
  const subtitleLanguagesToKeep = new Set();

  if (originalLanguage != null && primary_language !== originalLanguage) {
    if (hasPrimaryAudio && foreign_strategy === FOREIGN_STRATEGY.DUBS) {
      audioLanguagesToKeep.add(primary_language);
      audioLanguagesToKeep.add(originalLanguage);
    } else {
      audioLanguagesToKeep.add(originalLanguage);
      audioLanguagesToKeep.add(primary_language);
    }
  } else {
    audioLanguagesToKeep.add(primary_language);
  }

  subtitleLanguagesToKeep.add(primary_language);
  if (include_native_subs) {
    subtitleLanguagesToKeep.add(originalLanguage);
  }

  if (additional_languages !== '') {
    additional_languages.split(',').forEach((language) => {
      audioLanguagesToKeep.add(language);
      subtitleLanguagesToKeep.add(language);
    });
  }

  // eslint-disable-next-line import/no-unresolved
  const isoLanguages = require('@cospired/i18n-iso-languages');

  args.jobLog(`Original language: ${originalLanguage}, using code: ${isoLanguages.alpha2ToAlpha3B(originalLanguage)}`);

  const isoAudioLanguagesToKeep = new Set<string>();
  audioLanguagesToKeep.forEach((language) => {
    const isoLanguage = isoLanguages.alpha2ToAlpha3B(language);
    if (isoLanguage) {
      isoAudioLanguagesToKeep.add(isoLanguage);
    }
  });

  args.jobLog(`Keeping audio languages: ${Array.from(isoAudioLanguagesToKeep).join(', ')}`);

  const isoSubtitleLanguagesToKeep = new Set<string>();
  subtitleLanguagesToKeep.forEach((language) => {
    const isoLanguage = isoLanguages.alpha2ToAlpha3B(language);
    if (isoLanguage) {
      isoSubtitleLanguagesToKeep.add(isoLanguage);
    }
  });

  args.jobLog(`Keeping subtitle languages: ${Array.from(isoSubtitleLanguagesToKeep).join(', ')}`);

  const tracks = {
    audio: {
      keep: ([] as number[]),
      remove: ([] as number[]),
    },
    subtitle: {
      keep: ([] as number[]),
      remove: ([] as number[]),
    },
  };

  streams.forEach((stream, streamIdx) => {
    if ((stream.codec_type === 'audio' || stream.codec_type === 'subtitle')) {
      // Keep stream if it doesn't have any tags
      if (stream.tags == null) {
        args.jobLog(`No tags found on ${stream.codec_type} stream ${streamIdx}. Keeping it.`);
        tracks[stream.codec_type].keep.push(streamIdx);
        return;
      }

      // Keep stream if it doesn't have a language tag
      if (stream.tags?.language == null) {
        args.jobLog(`No language tag found on ${stream.codec_type} stream ${streamIdx}. Keeping it.`);
        tracks[stream.codec_type].keep.push(streamIdx);
        return;
      }

      // Remove commentary and description streams
      if (remove_commentary_tracks && stream.tags?.title != null) {
        const title = stream.tags.title.toLowerCase();
        if (title.includes('commentary') || title.includes('description')) {
          args.jobLog(
            `Removing commentary or description ${stream.codec_type} stream ${streamIdx} from title ${title}`,
          );
          stream.removed = true;
          tracks[stream.codec_type].remove.push(streamIdx);
          return;
        }
      }

      const shouldKeepStream = (() => {
        switch (stream.codec_type) {
          case 'audio':
            return isoAudioLanguagesToKeep.has(stream.tags.language);
          case 'subtitle':
            return isoSubtitleLanguagesToKeep.has(stream.tags.language);
          default:
            return false;
        }
      })();
      const languageName = isoLanguages.getName(stream.tags.language, 'en');
      if (shouldKeepStream) {
        args.jobLog(
          `Keeping ${stream.codec_type} stream ${streamIdx} with language ${languageName} (${stream.tags.language})`,
        );
        tracks[stream.codec_type].keep.push(streamIdx);
      } else {
        args.jobLog(
          `Removing ${stream.codec_type} stream ${streamIdx} with language ${languageName} (${stream.tags.language})`,
        );
        stream.removed = true;
        tracks[stream.codec_type].remove.push(streamIdx);
      }
    }
  });

  if (tracks.audio.keep.length === 0 && tracks.audio.remove.length > 0) {
    const message = 'All audio streams would be removed, aborting.';
    args.jobLog(message);
    throw new Error(message);
  }

  // Sort the streams
  const streamTypeOrder = ['video', 'audio', 'subtitle'];
  const audioLangOrder = Array.from(isoAudioLanguagesToKeep);
  const subtitleLangOrder = Array.from(isoSubtitleLanguagesToKeep);
  streams.sort((a, b): number => {
    const aValue = getSortValueFromStream(a, streamTypeOrder, audioLangOrder, subtitleLangOrder);
    const bValue = getSortValueFromStream(b, streamTypeOrder, audioLangOrder, subtitleLangOrder);
    return aValue - bValue;
  });

  // Set disposition flags
  let hasSetDefaultAudio = false;
  let hasSetDefaultSubtitle = false;
  let idx = 0;
  for (const stream of streams) {
    if (!stream.removed) {
      if (stream.codec_type === 'audio') {
        if (!hasSetDefaultAudio) {
          if (stream.disposition?.default === 0) {
            args.jobLog(`Setting default audio stream to output stream #${idx}`);
            stream.outputArgs.push('-c:{outputIndex}', 'copy', '-disposition:{outputIndex}', '+default');
          } else {
            args.jobLog(`Audio stream #${idx} is already the default stream`);
          }
          hasSetDefaultAudio = true;
        } else if (stream.disposition?.default === 1) {
          // remove the default disposition if it already exists
          args.jobLog(`Removing default audio stream from output stream #${idx}`);
          stream.outputArgs.push('-c:{outputIndex}', 'copy', '-disposition:{outputIndex}', '-default');
        }
      } else if (stream.codec_type === 'subtitle') {
        if (!hasSetDefaultSubtitle) {
          if (stream.disposition?.default === 0) {
            args.jobLog(`Setting default subtitle stream to output stream #${idx}`);
            stream.outputArgs.push('-c:{outputIndex}', 'copy', '-disposition:{outputIndex}', '+default');
          } else {
            args.jobLog(`Subtitle stream #${idx} is already the default stream`);
          }
          hasSetDefaultSubtitle = true;
        } else if (stream.disposition?.default === 1) {
          // remove the default disposition if it already exists
          args.jobLog(`Removing default subtitle stream from output stream #${idx}`);
          stream.outputArgs.push('-c:{outputIndex}', 'copy', '-disposition:{outputIndex}', '-default');
        }
      }
    }
    idx += 1;
  }

  if (JSON.stringify(streams) !== originalStreams) {
    args.variables.ffmpegCommand.shouldProcess = true;
    args.variables.ffmpegCommand.streams = streams;
  }

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
