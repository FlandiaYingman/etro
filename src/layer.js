import { _publish, subscribe } from './event.js'
import { watchPublic, val, applyOptions } from './util.js'

// TODO: implement "layer masks", like GIMP
// TODO: add aligning options, like horizontal and vertical align modes

/**
 * All layers have a
 * - start time
 * - duration
 * - list of effects
 * - an "active" flag
 */
export class Base {
  /**
     * Creates a new empty layer
     *
     * @param {number} startTime - when to start the layer on the movie"s timeline
     * @param {number} duration - how long the layer should last on the movie"s timeline
     */
  constructor (startTime, duration, options = {}) { // rn, options isn't used but I'm keeping it here
    const newThis = watchPublic(this) // proxy that will be returned by constructor
    // Don't send updates when initializing, so use this instead of newThis:
    applyOptions(options, this) // no options rn, but just to stick to protocol

    this._startTime = startTime
    this._duration = duration

    this._active = false // whether newThis layer is currently being rendered

    // on attach to movie
    subscribe(newThis, 'layer.attach', event => {
      newThis._movie = event.movie
    })

    // Propogate up to target
    subscribe(newThis, 'layer.change', event => {
      const typeOfChange = event.type.substring(event.type.lastIndexOf('.') + 1)
      const type = `movie.change.layer.${typeOfChange}`
      _publish(newThis._movie, type, { ...event, target: newThis._movie, source: event.source || newThis, type })
    })

    return newThis
  }

  /** Generic step function */
  _render () {}

  get _parent () {
    return this._movie
  }

  get active () {
    return this._active
  }

  // readonly
  get startTime () {
    return this._startTime
  }

  set startTime (val) {
    this._startTime = val
  }

  get duration () {
    return this._duration
  }

  set duration (val) {
    this._duration = val
  }
}
// id for events (independent of instance, but easy to access when on prototype chain)
Base.prototype._type = 'layer'

Base.prototype.getDefaultOptions = function () {
  return {}
}
Base.prototype._publicExcludes = []

/** Any layer that renders to a canvas */
export class Visual extends Base {
  /**
   * Creates a visual layer
   *
   * @param {number} startTime - when to start the layer on the movie"s timeline
   * @param {number} duration - how long the layer should last on the movie"s timeline
   * @param {number} [options.width=null] - the width of the entire layer
   * @param {number} [options.height=null] - the height of the entire layer
   * @param {object} [options] - various optional arguments
   * @param {number} [options.x=0] - the horizontal position of the layer (relative to the movie)
   * @param {number} [options.y=0] - the vertical position of the layer (relative to the movie)
   * @param {string} [options.background=null] - the background color of the layer, or <code>null</code>
   *  for a transparent background
   * @param {object} [options.border=null] - the layer's outline, or <code>null</code> for no outline
   * @param {string} [options.border.color] - the outline's color; required for a border
   * @param {string} [options.border.thickness=1] - the outline's weight
   * @param {number} [options.opacity=1] - the layer's opacity; <code>1</cod> for full opacity
   *  and <code>0</code> for full transparency
   */
  constructor (startTime, duration, options = {}) {
    super(startTime, duration, options)
    // only validate extra if not subclassed, because if subclcass, there will be extraneous options
    applyOptions(options, this)

    this._canvas = document.createElement('canvas')
    this._cctx = this.canvas.getContext('2d')

    this._effectsBack = []
    const that = this
    this._effects = new Proxy(this._effectsBack, {
      apply: function (target, thisArg, argumentsList) {
        return thisArg[target].apply(this, argumentsList)
      },
      deleteProperty: function (target, property) {
        return true
      },
      set: function (target, property, value, receiver) {
        target[property] = value
        if (!isNaN(property)) { // if property is an number (index)
          _publish(value, 'effect.attach', { source: that })
        }
        return true
      }
    })
  }

  /** Render visual output */
  _render (reltime) {
    this._beginRender(reltime)
    this._doRender(reltime)
    this._endRender(reltime)
  }

  _beginRender (reltime) {
    // if this.width or this.height is null, that means "take all available screen space", so set it to
    // this._move.width or this._movie.height, respectively
    const w = val(this.width || this._movie.width, this, reltime)
    const h = val(this.height || this._movie.height, this, reltime)
    this.canvas.width = w
    this.canvas.height = h
    this.cctx.globalAlpha = val(this.opacity, this, reltime)
  }

  _doRender (reltime) {
    // if this.width or this.height is null, that means "take all available screen space", so set it to
    // this._move.width or this._movie.height, respectively
    // canvas.width & canvas.height are already interpolated
    if (this.background) {
      this.cctx.fillStyle = val(this.background, this, reltime)
      this.cctx.fillRect(0, 0, this.canvas.width, this.canvas.height) // (0, 0) relative to layer
    }
    if (this.border && this.border.color) {
      this.cctx.strokeStyle = val(this.border.color, this, reltime)
      this.cctx.lineWidth = val(this.border.thickness, this, reltime) || 1 // this is optional.. TODO: integrate this with defaultOptions
    }
  }

  _endRender (reltime) {
    const w = val(this.width || this._movie.width, this, reltime)
    const h = val(this.height || this._movie.height, this, reltime)
    if (w * h > 0) {
      this._applyEffects()
    }
    // else InvalidStateError for drawing zero-area image in some effects, right?
  }

  _applyEffects () {
    for (let i = 0; i < this.effects.length; i++) {
      const effect = this.effects[i]
      effect.apply(this, this._movie.currentTime - this.startTime) // pass relative time
    }
  }

  addEffect (effect) {
    this.effects.push(effect); return this
  }

  get canvas () {
    return this._canvas
  }

  get cctx () {
    return this._cctx
  }

  get effects () {
    return this._effects // priavte (because it's a proxy)
  }
}
// TODO: move these inside class declaration?
Visual.prototype.getDefaultOptions = function () {
  return {
    ...Base.prototype.getDefaultOptions(),
    x: 0,
    y: 0,
    width: null,
    height: null,
    background: null,
    border: null,
    opacity: 1
  }
}
Visual.prototype._publicExcludes = Base.prototype._publicExcludes.concat(['canvas', 'cctx', 'effects'])

export class Text extends Visual {
  // TODO: is textX necessary? it seems inconsistent, because you can't define width/height directly for a text layer
  /**
   * Creates a new text layer
   *
   * @param {number} startTime
   * @param {number} duration
   * @param {string} text - the text to display
   * @param {number} width - the width of the entire layer
   * @param {number} height - the height of the entire layer
   * @param {object} [options] - various optional arguments
   * @param {number} [options.x=0] - the horizontal position of the layer (relative to the movie)
   * @param {number} [options.y=0] - the vertical position of the layer (relative to the movie)
   * @param {string} [options.background=null] - the background color of the layer, or <code>null</code>
   *  for a transparent background
   * @param {object} [options.border=null] - the layer"s outline, or <code>null</code> for no outline
   * @param {string} [options.border.color] - the outline"s color; required for a border
   * @param {string} [options.border.thickness=1] - the outline"s weight
   * @param {number} [options.opacity=1] - the layer"s opacity; <code>1</cod> for full opacity
   *  and <code>0</code> for full transparency
   * @param {string} [options.font="10px sans-serif"]
   * @param {string} [options.color="#fff"]
   * //@param {number} [options.width=textWidth] - the value to override width with
   * //@param {number} [options.height=textHeight] - the value to override height with
   * @param {number} [options.textX=0] - the text's horizontal offset relative to the layer
   * @param {number} [options.textY=0] - the text's vertical offset relative to the layer
   * @param {number} [options.maxWidth=null] - the maximum width of a line of text
   * @param {string} [options.textAlign="start"] - horizontal align
   * @param {string} [options.textBaseline="top"] - vertical align
   * @param {string} [options.textDirection="ltr"] - the text direction
   * TODO: add padding options
   */
  constructor (startTime, duration, text, options = {}) {
    //                          default to no (transparent) background
    super(startTime, duration, { background: null, ...options }) // fill in zeros in |_doRender|
    applyOptions(options, this, Text)

    this.text = text

    // this._prevText = undefined;
    // // because the canvas context rounds font size, but we need to be more accurate
    // // rn, this doesn't make a difference, because we can only measure metrics by integer font sizes
    // this._lastFont = undefined;
    // this._prevMaxWidth = undefined;
  }

  _doRender (reltime) {
    super._doRender(reltime)
    const text = val(this.text, this, reltime); const font = val(this.font, this, reltime)
    const maxWidth = this.maxWidth ? val(this.maxWidth, this, reltime) : undefined
    // // properties that affect metrics
    // if (this._prevText !== text || this._prevFont !== font || this._prevMaxWidth !== maxWidth)
    //     this._updateMetrics(text, font, maxWidth);

    this.cctx.font = font
    this.cctx.fillStyle = val(this.color, this, reltime)
    this.cctx.textAlign = val(this.textAlign, this, reltime)
    this.cctx.textBaseline = val(this.textBaseline, this, reltime)
    this.cctx.textDirection = val(this.textDirection, this, reltime)
    this.cctx.fillText(
      text, val(this.textX, this, reltime), val(this.textY, this, reltime),
      maxWidth
    )

    this._prevText = text
    this._prevFont = font
    this._prevMaxWidth = maxWidth
  }

  // _updateMetrics(text, font, maxWidth) {
  //     // TODO calculate / measure for non-integer font.size values
  //     let metrics = Text._measureText(text, font, maxWidth);
  //     // TODO: allow user-specified/overwritten width/height
  //     this.width = /*this.width || */metrics.width;
  //     this.height = /*this.height || */metrics.height;
  // }

  // TODO: implement setters and getters that update dimensions!

  /* static _measureText(text, font, maxWidth) {
        // TODO: fix too much bottom padding
        const s = document.createElement("span");
        s.textContent = text;
        s.style.font = font;
        s.style.padding = "0";
        if (maxWidth) s.style.maxWidth = maxWidth;
        document.body.appendChild(s);
        const metrics = {width: s.offsetWidth, height: s.offsetHeight};
        document.body.removeChild(s);
        return metrics;
    } */
}
Text.prototype.getDefaultOptions = function () {
  return {
    ...Visual.prototype.getDefaultOptions(),
    background: null,
    font: '10px sans-serif',
    color: '#fff',
    textX: 0,
    textY: 0,
    maxWidth: null,
    textAlign: 'start',
    textBaseline: 'top',
    textDirection: 'ltr'
  }
}

export class Image extends Visual {
  /**
   * Creates a new image layer
   *
   * @param {number} startTime
   * @param {number} duration
   * @param {HTMLImageElement} image
   * @param {object} [options]
   * @param {number} [options.x=0] - the horizontal position of the layer (relative to the movie)
   * @param {number} [options.y=0] - the vertical position of the layer (relative to the movie)
   * @param {string} [options.background=null] - the background color of the layer, or <code>null</code>
   *  for a transparent background
   * @param {object} [options.border=null] - the layer"s outline, or <code>null</code> for no outline
   * @param {string} [options.border.color] - the outline"s color; required for a border
   * @param {string} [options.border.thickness=1] - the outline"s weight
   * @param {number} [options.opacity=1] - the layer"s opacity; <code>1</cod> for full opacity
   *  and <code>0</code> for full transparency
   * @param {number} [options.clipX=0] - where to place the left edge of the image
   * @param {number} [options.clipY=0] - where to place the top edge of the image
   * @param {number} [options.clipWidth=0] - where to place the right edge of the image
   *  (relative to <code>options.clipX</code>)
   * @param {number} [options.clipHeight=0] - where to place the top edge of the image
   *  (relative to <code>options.clipY</code>)
   * @param {number} [options.imageX=0] - where to place the image horizonally relative to the layer
   * @param {number} [options.imageY=0] - where to place the image vertically relative to the layer
   */
  constructor (startTime, duration, image, options = {}) {
    super(startTime, duration, options) // wait to set width & height
    applyOptions(options, this, Image)
    // clipX... => how much to show of this.image
    // imageX... => how to project this.image onto the canvas
    this._image = image

    const load = () => {
      this.width = this.imageWidth = this.width || this.image.width
      this.height = this.imageHeight = this.height || this.image.height
      this.clipWidth = this.clipWidth || image.width
      this.clipHeight = this.clipHeight || image.height
    }
    if (image.complete) {
      load()
    } else {
      image.addEventListener('load', load)
    }
  }

  _doRender (reltime) {
    super._doRender(reltime) // clear/fill background
    this.cctx.drawImage(
      this.image,
      val(this.clipX, this, reltime), val(this.clipY, this, reltime),
      val(this.clipWidth, this, reltime), val(this.clipHeight, this, reltime),
      // this.imageX and this.imageY are relative to layer
      val(this.imageX, this, reltime), val(this.imageY, this, reltime),
      val(this.imageWidth, this, reltime), val(this.imageHeight, this, reltime)
    )
  }

  get image () {
    return this._image
  }
}
Image.prototype.getDefaultOptions = function () {
  return {
    ...Visual.prototype.getDefaultOptions(),
    clipX: 0,
    clipY: 0,
    clipWidth: undefined,
    clipHeight: undefined,
    imageX: 0,
    imageY: 0
  }
}

/**
 * Any layer that can be <em>played</em> individually extends this class;
 * Audio and Video
 */
// https://web.archive.org/web/20190111044453/http://justinfagnani.com/2015/12/21/real-mixins-with-javascript-classes/
// TODO: implement playback rate
export const MediaMixin = superclass => {
  if (superclass !== Base && superclass !== Visual) {
    throw new Error('Media can only extend Base and Visual')
  }

  class Media extends superclass {
    /**
     * @param {number} startTime
     * @param {HTMLVideoElement} media
     * @param {object} [options]
     * @param {number} [options.mediaStartTime=0] - at what time in the audio the layer starts
     * @param {numer} [options.duration=media.duration-options.mediaStartTime]
     * @param {boolean} [options.muted=false]
     * @param {number} [options.volume=1]
     * @param {number} [options.playbackRate=1]
     */
    constructor (startTime, media, onload, options = {}) {
      super(startTime, 0, options) // works with both Base and Visual
      this._initialized = false
      this._media = media
      this._mediaStartTime = options.mediaStartTime || 0
      applyOptions(options, this, Media)

      const load = () => {
        // TODO:              && ?
        if ((options.duration || (media.duration - this.mediaStartTime)) < 0) {
          throw new Error('Invalid options.duration or options.mediaStartTime')
        }
        this.duration = options.duration || (media.duration - this.mediaStartTime)
        // onload will use `this`, and can't bind itself because it's before super()
        onload && onload.bind(this)(media, options)
      }
      if (media.readyState >= 2) {
        // this frame's data is available now
        load()
      } else {
        // when this frame's data is available
        media.addEventListener('canplay', load)
      }

      subscribe(this, 'layer.attach', event => {
        subscribe(event.movie, 'movie.seek', event => {
          const time = event.movie.currentTime
          if (time < this.startTime || time >= this.startTime + this.duration) {
            return
          }
          this.media.currentTime = time - this.startTime
        })
        // connect to audiocontext
        this._source = event.movie.actx.createMediaElementSource(this.media)
        this.source.connect(event.movie.actx.destination)
      })
      // TODO: on unattach?
      subscribe(this, 'movie.audiodestinationupdate', event => {
        // reset destination
        this.source.disconnect()
        this.source.connect(event.destination)
      })
      subscribe(this, 'layer.start', () => {
        this.media.currentTime = this.mediaStartTime
        this.media.play()
      })
      subscribe(this, 'layer.stop', () => {
        this.media.pause()
      })
    }

    _render (reltime) {
      super._render(reltime)
      // even interpolate here
      // TODO: implement Issue: Create built-in audio node to support built-in audio nodes, as this does nothing rn
      this.media.muted = val(this.muted, this, reltime)
      this.media.volume = val(this.volume, this, reltime)
      this.media.playbackRate = val(this.playbackRate, this, reltime)
    }

    get media () {
      return this._media
    }

    get source () {
      return this._source
    }

    get startTime () {
      return this._startTime
    }

    set startTime (val) {
      this._startTime = val
      if (this._initialized) {
        const mediaProgress = this._movie.currentTime - this.startTime
        this.media.currentTime = this.mediaStartTime + mediaProgress
      }
    }

    set mediaStartTime (val) {
      this._mediaStartTime = val
      if (this._initialized) {
        const mediaProgress = this._movie.currentTime - this.startTime
        this.media.currentTime = mediaProgress + this.mediaStartTime
      }
    }

    get mediaStartTime () {
      return this._mediaStartTime
    }
  };
  Media.prototype.getDefaultOptions = function () {
    return {
      ...superclass.prototype.getDefaultOptions(),
      mediaStartTime: 0,
      duration: undefined, // important to include undefined keys, for applyOptions
      muted: false,
      volume: 1,
      playbackRate: 1
    }
  }

  return Media // custom mixin class
}

// use mixins instead of `extend`ing two classes (which doens't work); see below class def
export class Video extends MediaMixin(Visual) {
  /**
   * Creates a new video layer
   *
   * @param {number} startTime
   * @param {HTMLVideoElement} media
   * @param {object} [options]
   * @param {number} startTime
   * @param {HTMLVideoElement} media
   * @param {object} [options]
   * @param {number} [options.mediaStartTime=0] - at what time in the audio the layer starts
   * @param {numer} [options.duration=media.duration-options.mediaStartTime]
   * @param {boolean} [options.muted=false]
   * @param {number} [options.volume=1]
   * @param {number} [options.speed=1] - the audio's playerback rate
   * @param {number} [options.mediaStartTime=0] - at what time in the video the layer starts
   * @param {numer} [options.duration=media.duration-options.mediaStartTime]
   * @param {number} [options.clipX=0] - where to place the left edge of the image
   * @param {number} [options.clipY=0] - where to place the top edge of the image
   * @param {number} [options.clipWidth=0] - where to place the right edge of the image
   *  (relative to <code>options.clipX</code>)
   * @param {number} [options.clipHeight=0] - where to place the top edge of the image
   *  (relative to <code>options.clipY</code>)
   * @param {number} [options.mediaX=0] - where to place the image horizonally relative to the layer
   * @param {number} [options.mediaY=0] - where to place the image vertically relative to the layer
   */
  constructor (startTime, media, options = {}) {
    // fill in the zeros once loaded
    super(startTime, media, function () {
      this.width = this.mediaWidth = options.width || media.videoWidth
      this.height = this.mediaHeight = options.height || media.videoHeight
      this.clipWidth = options.clipWidth || media.videoWidth
      this.clipHeight = options.clipHeight || media.videoHeight
    }, options)
    // clipX... => how much to show of this.media
    // mediaX... => how to project this.media onto the canvas
    applyOptions(options, this, Video)
    if (this.duration === undefined) {
      this.duration = media.duration - this.mediaStartTime
    }
  }

  _doRender (reltime) {
    super._doRender()
    this.cctx.drawImage(this.media,
      val(this.clipX, this, reltime), val(this.clipY, this, reltime),
      val(this.clipWidth, this, reltime), val(this.clipHeight, this, reltime),
      val(this.mediaX, this, reltime), val(this.mediaY, this, reltime), // relative to layer
      val(this.mediaWidth, this, reltime), val(this.mediaHeight, this, reltime))
  }
}
Video.prototype.getDefaultOptions = function () {
  return {
    ...Object.getPrototypeOf(this).getDefaultOptions(), // let's not call MediaMixin again
    clipX: 0,
    clipY: 0,
    mediaX: 0,
    mediaY: 0,
    mediaWidth: undefined,
    mediaHeight: undefined
  }
}

export class Audio extends MediaMixin(Base) {
  /**
   * Creates an audio layer
   *
   * @param {number} startTime
   * @param {HTMLAudioElement} media
   * @param {object} [options]
   * @param {number} startTime
   * @param {HTMLVideoElement} media
   * @param {object} [options]
   * @param {number} [options.mediaStartTime=0] - at what time in the audio the layer starts
   * @param {numer} [options.duration=media.duration-options.mediaStartTime]
   * @param {boolean} [options.muted=false]
   * @param {number} [options.volume=1]
   * @param {number} [options.speed=1] - the audio's playerback rate
   */
  constructor (startTime, media, options = {}) {
    // fill in the zero once loaded, no width or height (will raise error)
    super(startTime, media, null, options)
    applyOptions(options, this, Audio)
    if (this.duration === undefined) {
      this.duration = media.duration - this.mediaStartTime
    }
  }
}
Audio.prototype.getDefaultOptions = function () {
  return {
    ...Object.getPrototypeOf(this).getDefaultOptions(), // let's not call MediaMixin again
    mediaStartTime: 0,
    duration: undefined
  }
}
