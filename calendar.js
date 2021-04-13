//-----------------------------------------------------------------------------
// TFR Calendar Poster
// (c) 2020 Potter-MoonGuard
//
// A script to read calendar events for the day, format them, and post them to
//  Discord webhooks.
///////////////////////////////////////////////////////////////////////////////

var html_entities = {
  "&amp;"  : "&",
  "&lt;"   : "<",
  "&gt;"   : ">",
  "&nbsp;" : " "
}

function ReplaceHTMLEntity( str ) {
  return html_entities[str] || str;
}

//-----------------------------------------------------------------------------
//  very primitive conversion but should work for most simple description.
function HTMLtoDiscord( html ) {
  // Fast exit if the description is empty.
  if( !html || html.length == 0 ) return "";
  
  // Convert <br> to line breaks.
  html = html.replace( /<br>/g, "\n" );
  
  // Convert list items. Can't really do much about ordered lists without a
  //  massive headache. All will appear as bulleted lists.
  html = html.replace( /<li>/g, "\n• " );
  
  // Basic conversion of the styling tags.
  // The regex \s* magic is to move the marks to be adjacent to the content,
  //  otherwise the markdown will break.
  // Will probably break anyway if they're using mixed formatting without
  //  caring about not leaving it hanging on whitespace.
  html = html.replace( /<b>(\s*)/g, "$1**" );
  html = html.replace( /(\s*)<\/b>/g, "**$1" );
  
  html = html.replace( /<u>(\s*)/g, "$1__" );
  html = html.replace( /(\s*)<\/u>/g, "__$1" );
  
  html = html.replace( /<i>(\s*)/g, "$1*" );
  html = html.replace( /(\s*)<\/i>/g, "*$1" );
  
  // Convert links.
  // Input example: <a href="poop.url">link text</a>
  // Output example: [link text](poop.url)
  // Discord supports these in embed objects.
  html = html.replace( /<a[^>]* href="([^"]+)"[^>]*>(.+?)<\/a>/g, "[$2]($1)" );
  
  Logger.log(html);
  
  // Catch ends of paragraphs and divs. (This will fuck up with inline divs but oh well.)
  html = html.replace( /<\/(div|p|h\d)>/g, "\n" );
  
  // And throw away any leftover tags that weren't handled.
  html = html.replace( /<[^>]*>/g, "" );
  
  // Convert HTMl entities back into normal characters.
  html = html.replace( /&.+?;/g, ReplaceHTMLEntity );
  
  return html
}

//-----------------------------------------------------------------------------
// Tries to parse a time from a title string.
function parseTitleTime( title ) {
  // Format examples detected:
  // "8pm" "8 PM" "8:00 pm" "8:00 p.m."
  var time_hour, time_minute, time_found;
  
  function matcher( match, p1, p2, p3, p4, p5, offset, string ) {
    time_found = true;
    time_hour = p1;
    time_minute = p3 || "00"
    time_a = (p5 || "p").toLowerCase();
    return " ";
  };
  
  // These capture groups require am/pm because they have an optional minute component.
  title = title.replace( /\s*\(?(\d+)(:(\d\d))? ?((a|p)\.?m\.?)(\)?|\b)\s*/mi, matcher );
  if( !time_found ) {
    
    // This one requires the minute part of the time.
    title = title.replace( /\s*\(?(\d+)(:(\d\d)) ?((a|p)\.?m\.?)?(\)?|\b)\s*/mi, matcher );
  }
  
  if( time_found ) {
    time_hour = parseInt( time_hour );
    if( time_hour == 12 ) time_hour = 0;
    time_minute = parseInt( time_minute );
    if( time_a == 'p' ) time_hour += 12;
    
    return {
      title: title.trim(),
      time: time_hour * 60 + time_minute
    }
  }
  return null;
}

//-----------------------------------------------------------------------------
// Read the events today from the list of calendars given and post them to a
//  Discord channel.
// options:
//   calendars: Array of calendar IDs to read events from. The script host must
//               own or be subscribed to the calendars to read them. The public
//               API is not supported because the documentation sucks.
//   webhooks: Array of Discord webhooks to post the results to (for
//              broadcasting to multiple channels).
//   title: The title that will be printed in the embed object,
//           e.g., "The First Regiment Calendar"
//   public_url: A URL to the public calendar for the user.
//
function postEventsToDiscord( options ) {
  var today = new Date();
  
  if( options.day_override ) {
    today.setDate( options.day_override );
  }
  
  // Compare event start times with this to determine if they span multiple
  //  days. For writing (continued) in the event header as opposed to a
  //  specific time.
  var last_midnight = new Date();
  last_midnight.setHours( 0, 0, 0, 0 );
  
  var events = [];
  
  // Note that the timezone used with all of the time functions should be
  //  the same as the script host, and they should have their settings set
  //  to CENTRAL time to match Moon Guard.
  for( var calendar_index = 0; calendar_index < options.calendars.length; calendar_index++ ) {
    var calendar = CalendarApp.getCalendarById( options.calendars[calendar_index] );
    if( !calendar ) {
      Logger.log( "Couldn't fetch calendar with ID:", calendar_id );
      continue;
    }
    
    var calendar_events = calendar.getEventsForDay( today );
    
    for( var i = 0; i < calendar_events.length; i++ ) {
      var event = calendar_events[i];
      var event_item = {};
      
      // Strip HTML from description.
      event_item.description = HTMLtoDiscord( event.getDescription() );
      
      // Style title with a bullet prefix.
      var title = event.getTitle();
      var start_time = event.getStartTime();
      
      // Parse time from title.
      var title_time = parseTitleTime( title );
      if( title_time ) {
        event_item.title = title_time.title;
        event_item.time  = title_time.time;
      } else {
        event_item.title = title;
        
        var start_time = event.getStartTime();
      
        if( start_time < last_midnight ) {
          // Start time is before today, so this event is continuing into today.
          event_item.time = -2;
        } else if( event.isAllDayEvent() ) {
          // Event is an "all-day" event, and we don't know the start time. Could
          //  default to 8:00 p.m.?
          event_item.time = -1;
        } else {
          // Event has a specific time set, so use that.
          // We need to be extra careful here turning a time into hours+minutes. Daylight savings is a bitch.
          var hours = parseInt(Utilities.formatDate( start_time, "America/Chicago", "H" ));
          var minutes = parseInt(Utilities.formatDate( start_time, "America/Chicago", "mm" ));
          
          event_item.time = hours * 60 + minutes;
        }
      }
      
      event_item.color = parseInt( calendar.getColor().replace( "#", "" ), 16 );
      
      events.push( event_item );
    }
    
  }
  
  var output;
  
  if( events.length == 0 ) {
    // Message shown when no events are found for the day.
    output = "*No events are posted for today.*";
  } else {
    events = events.sort( function( a, b ) {
      if( a.time < b.time ) {
        return -1;
      } else if( a.time > b.time ) {
        return 1;
      }
      return a.title.toLocaleLowerCase().localeCompare( b.title.toLocaleLowerCase() );
    });
    
    var pump_header = true;
    output = "The following events are posted for today:\n\n";
    
    function pump() {
      //---------------------------------------------------------------------------
      // Discord Webhook data.
      var data = {
        // Content can be empty if there are embeds.
        content: "",
        embeds: [{
          // And display our built output.
          description: output.trim()
        }]
      };
      
      if( pump_header ) {
        data.embeds[0].title = ":calendar_spiral: " + options.title;
        if( options.public_url ) data.embeds[0].url = options.public_url;
      }
      
      // "Post" to the Discord webhook.
      var post_options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify( data )
      };
      
      for( var i = 0; i < options.webhooks.length; i++ ) {
        var response = UrlFetchApp.fetch( options.webhooks[i], post_options );
      }
      
      output = ""
      pump_header = false
    }
    
    for( var i = 0; i < events.length; i++ ) {
      var event = events[i];
      var time = "";
      if( event.time == -2 ) {
        time = "continued";
      } else if( event.time == -1 ) {
        time = "";
      } else {
        var hour = Math.floor(event.time / 60);
        var minute = event.time - hour * 60;
        if( minute < 10 ) minute = "0" + minute;
        var pm = hour >= 12 ? "p.m." : "a.m.";
        hour = hour % 12;
        if( hour == 0 ) hour = 12;
        time = hour.toString() + ":" + minute + " " + pm
      }
      
      var event_text;
      
      event_text = "**• " + event.title + "**";
      
      if( time ) {
        event_text += " (" + time + ")"
      }
      
      event_text += "\n";
      if( event.description ) {
        event_text += event.description + "\n";
      }
      
      if( event_text.length > 1800 ) {
        event_text = event_text.substring( 0, 1800 ) + "...";
      }
      
      if( output.length + event_text.length > 2000 ) {
        pump();
      }
      output += event_text + "\n";
    }
    pump();
    
  }
  
}

//-----------------------------------------------------------------------------
// Calendars to read events from
var calendar_list = [
  "example@group.calendar.google.com",
  "example2@group.calendar.google.com",
];

// Where to post the calendars.
var discord_webhooks = [
  "https://discordapp.com/api/webhooks/example/example", // Discord server 1 to post to
  "https://discordapp.com/api/webhooks/example2/example2", // Discord server 2 to post to
];


//-----------------------------------------------------------------------------
// Production function that's executed through a time-based script trigger.
function dailyTrigger() {
  postEventsToDiscord({
    calendars: calendar_list,
    webhooks: discord_webhooks,
    title: "My calendar shit",
    public_url: "URL to public calendar (or any URL when you click the title)"
  });
}

///////////////////////////////////////////////////////////////////////////////


