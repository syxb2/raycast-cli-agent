-- Source of "Ask AI.app". install.sh replaces __ASK_SCRIPT__ with the path of
-- ask.py and compiles it with osacompile.
on run
	set question to ""
	repeat
		try
			set question to text returned of (display dialog "Ask anything:" default answer question with title "Ask AI" buttons {"Cancel", "Ask"} default button "Ask" cancel button "Cancel")
		on error number -128
			return
		end try
		if question is "" then return
		set progress description to "Thinking…"
		set progress additional description to question
		set answer to do shell script "printf %s " & quoted form of question & " | " & quoted form of "__ASK_SCRIPT__"
		set progress description to ""
		set reply to button returned of (display dialog answer with title "Ask AI" buttons {"Copy", "Ask Another", "Done"} default button "Done")
		if reply is "Copy" then
			set the clipboard to answer
			return
		else if reply is "Done" then
			return
		end if
		set question to ""
	end repeat
end run
